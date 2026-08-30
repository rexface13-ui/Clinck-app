<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\CheckModel;
use App\Models\Expense;
use App\Models\Income;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\Setting;
use App\Models\SupplierTransaction;
use App\Models\ToothFinding;
use App\Models\ToothState;
use App\Support\Dental\ToothChartSvgBuilder;
use Illuminate\Support\Carbon;

/**
 * All daily-closing-report HTML building, extracted out of the
 * GenerateDailyReport Artisan command so a controller (the "إغلاق المحل"
 * button) can call the exact same logic the nightly scheduler does — one
 * place that builds the report, two ways to trigger it.
 */
class DailyReportService
{
    protected const C_GREEN = '#1D9E75';

    protected const C_BLUE = '#185FA5';

    protected const C_RED = '#EF4444';

    protected const C_AMBER = '#F59E0B';

    protected const C_GRAY = '#F3F4F6';

    protected const C_MGRAY = '#9CA3AF';

    protected const C_DARK = '#1F2937';

    public function buildReportHtml(Carbon $date): string
    {
        $dateStr = $date->toDateString();
        $timezone = config('dentaflow.display_timezone');
        $dayStart = Carbon::parse($dateStr, $timezone)->startOfDay();
        [$dayStartUtc, $dayEndUtc] = [$dayStart->clone()->timezone('UTC'), $dayStart->clone()->endOfDay()->timezone('UTC')];
        $clinicName = Setting::where('key', 'clinic_name')->value('value') ?? 'DentaFlow';
        $money = fn ($n) => number_format((float) $n, 2);

        // ── الوارد اليوم (نفس اتفاقية "الوارد الموحّد" بـ IncomeController) ──
        $incomeTx = CashboxTransaction::with('cashbox')
            ->whereIn('type', ['income_in', 'payment_in'])
            ->whereDate('occurred_at', $dateStr)
            ->get();
        $incomesById = Income::whereIn('id', $incomeTx->where('type', 'income_in')->pluck('reference_id'))->get()->keyBy('id');
        $paymentsById = Payment::with('patient')->whereIn('id', $incomeTx->where('type', 'payment_in')->pluck('reference_id'))->get()->keyBy('id');
        $incomeTotalIls = $incomeTx->sum(fn ($t) => $t->type === 'income_in' ? (float) ($incomesById->get($t->reference_id)?->amount_ils ?? $t->amount) : (float) ($paymentsById->get($t->reference_id)?->amount_ils ?? $t->amount));

        // ── مصاريف اليوم ──
        $expenses = Expense::with('cashbox', 'category')->whereDate('spent_at', $dateStr)->get();
        $expenseTotalIls = (float) $expenses->sum('amount_ils');

        // ── فواتير/مرضى اليوم بالتفصيل ──
        $invoices = Invoice::with('patient')
            ->whereBetween('issued_at', [$dayStartUtc, $dayEndUtc])
            ->orderBy('issued_at')
            ->get();
        $revenueIls = (float) $invoices->sum('total_amount_ils');

        // ── شغل اليوم بالتفصيل — أي سن/خطوة انفوترت اليوم، مين سواها ──
        $workLines = InvoiceLine::with([
            'invoice.patient',
            'workItemToothStep.workItem.service',
            'workItemToothStep.workItem.doctor',
            'workItemToothStep.step',
        ])
            ->whereHas('invoice', fn ($q) => $q->whereBetween('issued_at', [$dayStartUtc, $dayEndUtc]))
            ->get();

        // ── حجوزات اليوم ──
        $appointments = Appointment::with(['patient:id,full_name', 'doctor:id,full_name'])
            ->whereBetween('starts_at', [$dayStartUtc, $dayEndUtc])
            ->orderBy('starts_at')
            ->get();

        // ── مرضى جدد اليوم ──
        $newPatients = Patient::whereBetween('created_at', [$dayStartUtc, $dayEndUtc])->get(['id', 'full_name', 'code', 'phone']);

        // ── طرق الدفع ──
        $paymentRows = Payment::whereBetween('paid_at', [$dayStartUtc, $dayEndUtc])->get(['method', 'amount_ils']);
        $methodLabels = ['cash' => 'نقدي', 'card' => 'بطاقة', 'transfer' => 'تحويل', 'check' => 'شيك'];
        $methodTotals = [];
        foreach ($paymentRows as $p) {
            $methodTotals[$p->method] = ($methodTotals[$p->method] ?? 0) + (float) $p->amount_ils;
        }
        $checksInToday = (float) CheckModel::where('direction', 'incoming')->where('party_type', 'patient')
            ->where('status', '!=', 'bounced')
            ->whereBetween('received_at', [$dayStartUtc, $dayEndUtc])
            ->sum('amount');
        if ($checksInToday > 0) {
            $methodTotals['check'] = ($methodTotals['check'] ?? 0) + $checksInToday;
        }
        $collectedIls = array_sum($methodTotals);

        // ── شيكات اليوم ──
        $checksToday = CheckModel::whereDate('received_at', $dateStr)->get();

        // ── أرصدة الصناديق ──
        $cashboxes = Cashbox::all();

        // ── ديون المرضى، مجمّعة حسب عائلة القرابة ──
        [$patientDebts, $totalPatientDebt] = $this->patientDebtsByFamily();

        // ── ديون الموردين ──
        $supplierDebts = SupplierTransaction::with('supplier:id,name')->get()
            ->groupBy('supplier_id')
            ->map(fn ($rows) => ['name' => $rows->first()->supplier?->name ?? 'مورد محذوف', 'balance' => round((float) $rows->sum('amount_ils'), 2)])
            ->filter(fn ($s) => $s['balance'] > 0.01)
            ->sortByDesc('balance')
            ->values();
        $totalSupplierDebt = $supplierDebts->sum('balance');

        $net = $incomeTotalIls - $expenseTotalIls;

        $summary = $this->kvGrid([
            ['الوارد', $money($incomeTotalIls).' ₪'],
            ['المصاريف', $money($expenseTotalIls).' ₪'],
            ['الصافي', $money($net).' ₪'],
            ['إيراد الفواتير', $money($revenueIls).' ₪'],
            ['المحصّل', $money($collectedIls).' ₪'],
            ['مرضى جدد', (string) $newPatients->count()],
            ['حجوزات اليوم', (string) $appointments->count()],
            ['إجمالي ديون المرضى', $money($totalPatientDebt).' ₪'],
        ]);

        $appointmentsSection = $this->section('📅 حجوزات اليوم', self::C_GREEN, $appointments->isEmpty()
            ? '<p class="empty">لا توجد حجوزات اليوم</p>'
            : $this->dataTable(['الوقت', 'المريض', 'الطبيب', 'الحالة'], $appointments->map(fn (Appointment $a) => [
                Carbon::parse($a->starts_at)->timezone($timezone)->format('H:i'),
                $a->patient?->full_name ?? '—',
                $a->doctor?->full_name ?? '—',
                $this->appointmentStatusLabel($a->status),
            ])->all()));

        $invoicesSection = $this->section('🧾 فواتير اليوم', self::C_GREEN, $invoices->isEmpty()
            ? '<p class="empty">لا توجد فواتير اليوم</p>'
            : $this->dataTable(['المريض', 'رقم الفاتورة', 'المبلغ', 'الحالة'], $invoices->map(fn ($i) => [
                $i->patient?->full_name ?? 'مريض محذوف',
                $i->invoice_number,
                $money($i->total_amount_ils).' ₪',
                $this->invoiceStatusLabel($i->status),
            ])->all()));

        $workSection = $this->section('🦷 الشغل اللي انعمل اليوم', self::C_GREEN, $this->buildWorkTodayContent($workLines, $money));

        $newPatientsSection = $this->section('🧑‍⚕️ مرضى جدد اليوم', self::C_BLUE, $newPatients->isEmpty()
            ? '<p class="empty">لا يوجد تسجيل مرضى جدد اليوم</p>'
            : $this->dataTable(['الاسم', 'الكود', 'الهاتف'], $newPatients->map(fn ($p) => [$p->full_name, $p->code, $p->phone ?: '—'])->all(), self::C_BLUE));

        $methodsSection = $this->section('💳 طرق الدفع اليوم', self::C_GREEN, empty($methodTotals)
            ? '<p class="empty">لا يوجد تحصيل اليوم</p>'
            : $this->dataTable(['الطريقة', 'المبلغ'], collect($methodTotals)->map(fn ($v, $m) => [$methodLabels[$m] ?? $m, $money($v).' ₪'])->values()->all()));

        $expensesSection = $this->section('💸 مصاريف اليوم', self::C_RED, $expenses->isEmpty()
            ? '<p class="empty">لا توجد مصاريف اليوم</p>'
            : $this->dataTable(['التصنيف', 'الصندوق', 'المبلغ'], $expenses->map(fn ($e) => [$e->category?->name ?? 'أخرى', $e->cashbox?->name ?? '—', $money($e->amount_ils).' ₪'])->all(), self::C_RED));

        $checksSection = $this->section('🏦 شيكات اليوم', self::C_AMBER, $checksToday->isEmpty()
            ? '<p class="empty">لا توجد شيكات اليوم</p>'
            : $this->dataTable(['الاتجاه', 'رقم الشيك', 'المبلغ'], $checksToday->map(fn ($c) => [$c->direction === 'incoming' ? 'وارد' : 'صادر', $c->check_number, $money($c->amount).' '.$c->currency])->all(), self::C_AMBER));

        $cashboxSection = $this->section('💰 أرصدة الصناديق الحالية', self::C_BLUE,
            $this->dataTable(['الصندوق', 'العملة', 'الرصيد'], $cashboxes->map(fn ($c) => [$c->name, $c->currency, $money($c->balance)])->all(), self::C_BLUE));

        $patientDebtsRows = $patientDebts->map(fn ($p) => [$p['name'], $money($p['balance']).' ₪'])->all();
        if ($patientDebts->isNotEmpty()) {
            $patientDebtsRows[] = ['الإجمالي', $money($totalPatientDebt).' ₪'];
        }
        $patientDebtsSection = $this->section('⚠️ ديون المرضى (مجمّعة حسب القرابة)', self::C_RED, $patientDebts->isEmpty()
            ? '<p class="empty ok">✅ لا توجد ديون على المرضى</p>'
            : $this->dataTable(['المريض / العائلة', 'المستحق'], $patientDebtsRows, self::C_RED));

        $supplierDebtsRows = $supplierDebts->map(fn ($s) => [$s['name'], $money($s['balance']).' ₪'])->all();
        if ($supplierDebts->isNotEmpty()) {
            $supplierDebtsRows[] = ['الإجمالي', $money($totalSupplierDebt).' ₪'];
        }
        $supplierDebtsSection = $this->section('📦 ديون الموردين', self::C_AMBER, $supplierDebts->isEmpty()
            ? '<p class="empty ok">✅ لا توجد ديون للموردين</p>'
            : $this->dataTable(['المورد', 'المستحق'], $supplierDebtsRows, self::C_AMBER));

        $body = $summary.$appointmentsSection.$invoicesSection.$workSection.$newPatientsSection.$methodsSection
            .$expensesSection.$checksSection.$cashboxSection.$patientDebtsSection.$supplierDebtsSection;

        return $this->wrapPage('تقرير الإغلاق اليومي', $clinicName, $date->format('d/m/Y'), $body, $this->sessionsLogLinkBanner());
    }

    /**
     * Every invoice line ever billed, across every patient — the full
     * session/treatment history, not scoped to one day. Meant to be
     * published once as its own standalone page (sessions.html) alongside
     * the daily report, so "what did we ever do for this patient" is always
     * a click away instead of locked behind a login.
     */
    public function buildSessionsLogHtml(): string
    {
        $money = fn ($n) => number_format((float) $n, 2);
        $timezone = config('dentaflow.display_timezone');
        $clinicName = Setting::where('key', 'clinic_name')->value('value') ?? 'DentaFlow';

        $lines = InvoiceLine::with([
            'invoice.patient',
            'workItemToothStep.workItem.service',
            'workItemToothStep.workItem.doctor',
            'workItemToothStep.step',
        ])
            ->join('invoices', 'invoices.id', '=', 'invoice_lines.invoice_id')
            ->orderByDesc('invoices.issued_at')
            ->select('invoice_lines.*')
            ->get();

        $rows = $lines->map(function (InvoiceLine $line) use ($money, $timezone) {
            $toothStep = $line->workItemToothStep;
            $workItem = $toothStep?->workItem;

            return [
                $line->invoice ? Carbon::parse($line->invoice->issued_at)->timezone($timezone)->format('d/m/Y H:i') : '—',
                $line->invoice?->patient?->full_name ?? 'مريض محذوف',
                $toothStep ? (int) $toothStep->tooth_number : '—',
                $toothStep?->step?->title ?? $workItem?->service?->name ?? $line->description ?? '—',
                $workItem?->doctor?->full_name ?? '—',
                $money($line->amount_ils).' ₪',
            ];
        })->all();

        $content = $this->section('📋 كل الجلسات ('.count($rows).')', self::C_GREEN, empty($rows)
            ? '<p class="empty">لا يوجد أي شغل مسجّل بعد</p>'
            : $this->dataTable(['التاريخ', 'المريض', 'السن', 'الخدمة / الخطوة', 'الطبيب', 'السعر'], $rows));

        return $this->wrapPage('سجل الجلسات الكامل', $clinicName, null, $content);
    }

    /**
     * @return array{0: \Illuminate\Support\Collection, 1: float}
     */
    protected function patientDebtsByFamily(): array
    {
        $allPatients = Patient::with(['transactions' => fn ($q) => $q->orderBy('occurred_at')])->get()->keyBy('id');
        $balances = $allPatients->map(fn (Patient $p) => $p->transactions->reduce(
            fn ($carry, $t) => $carry + (in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils),
            0.0
        ));

        $visited = [];
        $patientDebts = collect();
        foreach ($allPatients as $id => $patient) {
            if (isset($visited[$id])) {
                continue;
            }
            $groupIds = $patient->relativeGroupIds();
            foreach ($groupIds as $gid) {
                $visited[$gid] = true;
            }
            $netBalance = round(collect($groupIds)->sum(fn ($gid) => $balances->get($gid, 0.0)), 2);
            if ($netBalance <= 0.01) {
                continue;
            }
            $names = collect($groupIds)->map(fn ($gid) => $allPatients->get($gid)?->full_name)->filter()->values();
            $patientDebts->push(['name' => $names->implode(' + '), 'balance' => $netBalance]);
        }
        $patientDebts = $patientDebts->sortByDesc('balance')->values();

        return [$patientDebts, $patientDebts->sum('balance')];
    }

    /**
     * One mini-card per patient who had work today: what was done (table),
     * next to a live snapshot of their current full tooth chart (built via
     * ToothChartSvgBuilder from their real ToothFinding/ToothState rows),
     * with today's teeth ringed in amber so they stand out from older work.
     */
    protected function buildWorkTodayContent($workLines, callable $money): string
    {
        if ($workLines->isEmpty()) {
            return '<p class="empty">لا يوجد شغل مسجّل اليوم</p>';
        }

        $byPatient = $workLines->groupBy(fn ($l) => $l->invoice?->patient_id ?? 0);
        $builder = new ToothChartSvgBuilder;
        $cards = '';

        foreach ($byPatient as $patientId => $lines) {
            $patient = $lines->first()->invoice?->patient;
            $patientName = $patient?->full_name ?? 'مريض محذوف';

            $rows = $lines->map(function ($line) use ($money) {
                $toothStep = $line->workItemToothStep;
                $workItem = $toothStep?->workItem;

                return [
                    $toothStep ? (int) $toothStep->tooth_number : '—',
                    $toothStep?->step?->title ?? $workItem?->service?->name ?? $line->description ?? '—',
                    $workItem?->doctor?->full_name ?? '—',
                    $money($line->amount_ils).' ₪',
                ];
            })->all();

            $table = $this->dataTable(['السن', 'الخدمة / الخطوة', 'الطبيب', 'السعر'], $rows);

            $chart = '';
            if ($patient) {
                $findings = ToothFinding::where('patient_id', $patientId)->where('status', 'done')->with('service')->get();
                $toothColors = [];
                foreach ($findings as $f) {
                    if ($f->service?->color) {
                        $toothColors[(int) $f->tooth_number] = $f->service->color;
                    }
                }
                $missing = ToothState::where('patient_id', $patientId)->where('status', 'missing')
                    ->pluck('tooth_number')->map(fn ($n) => (int) $n)->flip()->map(fn () => true)->all();
                $todayTeeth = $lines->map(fn ($l) => $l->workItemToothStep ? (int) $l->workItemToothStep->tooth_number : null)->filter()->unique()->values()->all();

                $chart = '<div class="tooth-chart-wrap">'.$builder->build($toothColors, $missing, $todayTeeth, (bool) $patient->is_child).'</div>';
            }

            $cards .= '<div class="patient-work-card"><h3 class="patient-work-name">👤 '.$patientName.'</h3>'.
                '<div class="patient-work-body">'.$table.$chart.'</div></div>';
        }

        return $cards;
    }

    protected function appointmentStatusLabel(string $status): string
    {
        return match ($status) {
            'scheduled' => 'مجدول',
            'confirmed' => 'مؤكد',
            'done' => 'تمّت',
            'cancelled' => 'ملغي',
            'no_show' => 'لم يحضر',
            default => $status,
        };
    }

    protected function invoiceStatusLabel(string $status): string
    {
        return match ($status) {
            'paid' => 'مدفوعة',
            'partial' => 'جزئية',
            'void' => 'ملغاة',
            default => 'غير مدفوعة',
        };
    }

    // ── building blocks (Dazzling html_report_generator.py-inspired) ──

    public function kvGrid(array $pairs): string
    {
        $cells = collect($pairs)
            ->map(fn ($p) => '<div class="kv-cell"><span class="kv-label">'.$p[0].'</span><span class="kv-val">'.$p[1].'</span></div>')
            ->implode('');

        return "<div class=\"kv-grid\">{$cells}</div>";
    }

    public function section(string $title, string $color, string $content): string
    {
        return "<div class=\"section\"><div class=\"section-title\" style=\"background:{$color};\">{$title}</div>{$content}</div>";
    }

    public function dataTable(array $headers, array $rows, string $color = self::C_GREEN): string
    {
        $th = collect($headers)->map(fn ($h) => "<th>{$h}</th>")->implode('');
        $body = collect($rows)->map(function ($row) {
            $td = collect($row)->map(fn ($cell) => "<td>{$cell}</td>")->implode('');

            return "<tr>{$td}</tr>";
        })->implode('');

        return "<div class=\"table-wrap\"><table><thead style=\"background:{$color};\"><tr>{$th}</tr></thead><tbody>{$body}</tbody></table></div>";
    }

    /**
     * A small fixed banner linking to the full sessions log — present on
     * both the daily report and (harmlessly, just unused) skipped for the
     * log page itself. Kept as a separate method so wrapPage() doesn't need
     * to know which page it's building.
     */
    protected function sessionsLogLinkBanner(): string
    {
        return '<a href="sessions.html" class="sessions-link">📋 سجل الجلسات الكامل — كل الزيارات من أول يوم</a>';
    }

    public function wrapPage(string $title, string $clinicName, ?string $dateLabel, string $body, string $banner = ''): string
    {
        $css = $this->css();
        $js = $this->js();
        $dateHtml = $dateLabel ? "<span class=\"app-date\">{$dateLabel}</span>" : '';

        return <<<HTML
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{$title} — {$clinicName}</title>
<style>{$css}</style>
</head>
<body>
<header class="app-header">
  <span class="tooth-emoji">🦷</span>
  <h1>{$title} — {$clinicName}</h1>
  {$dateHtml}
</header>
{$banner}
<div class="search-bar">
  <input id="search-input" type="search" placeholder="🔍 بحث بالتقرير..." autocomplete="off">
</div>
<div id="no-result" class="no-result">لا توجد نتائج تطابق البحث</div>
<div class="content">{$body}</div>
<script>{$js}</script>
</body>
</html>
HTML;
    }

    protected function css(): string
    {
        $green = self::C_GREEN;
        $blue = self::C_BLUE;
        $dark = self::C_DARK;
        $mgray = self::C_MGRAY;

        return <<<CSS
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#F0F2F5;color:{$dark};direction:rtl;font-size:14px;}
.app-header{background:linear-gradient(135deg,{$green},{$blue});padding:16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.2);}
.tooth-emoji{font-size:22px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.15));}
.app-header h1{color:#fff;font-size:16px;flex:1;}
.app-date{color:rgba(255,255,255,.85);font-size:12px;white-space:nowrap;background:rgba(255,255,255,.15);padding:3px 10px;border-radius:999px;}
.sessions-link{display:block;background:#fff;text-align:center;padding:9px;font-size:13px;font-weight:600;color:{$blue};text-decoration:none;border-bottom:1px solid #E5E7EB;}
.sessions-link:hover{background:#F9FAFB;}
.search-bar{padding:10px 16px;background:#fff;border-bottom:1px solid #E5E7EB;position:sticky;top:0;z-index:99;}
.search-bar input{width:100%;padding:9px 12px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;outline:none;direction:rtl;}
.search-bar input:focus{border-color:{$green};}
.content{padding:14px;max-width:900px;margin:0 auto;}
.section{background:#fff;border-radius:12px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07);}
.section-title{padding:11px 14px;color:#fff;font-size:14px;font-weight:600;}
.kv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;padding:12px;margin-bottom:14px;}
.kv-cell{background:#fff;border-radius:10px;padding:10px 12px;box-shadow:0 1px 3px rgba(0,0,0,.08);}
.kv-label{display:block;font-size:11px;color:{$mgray};margin-bottom:3px;}
.kv-val{display:block;font-size:15px;font-weight:700;color:{$dark};}
.table-wrap{overflow-x:auto;}
table{width:100%;border-collapse:collapse;min-width:380px;}
thead tr th{padding:8px 10px;color:#fff;text-align:right;font-size:12px;white-space:nowrap;}
tbody tr td{padding:7px 10px;font-size:13px;text-align:right;border-bottom:1px solid #F3F4F6;}
tbody tr:nth-child(even){background:#F9FAFB;}
.empty{padding:16px;color:{$mgray};text-align:center;font-size:13px;}
.empty.ok{color:{$green};}
mark{background:#FEF3C7;color:{$dark};border-radius:2px;padding:0 1px;}
.no-result{text-align:center;padding:40px 20px;color:{$mgray};font-size:14px;display:none;}
.patient-work-card{border-top:1px solid #F0F1F3;padding:12px 14px;}
.patient-work-card:first-child{border-top:none;}
.patient-work-name{font-size:13px;font-weight:700;color:{$dark};margin-bottom:8px;}
.patient-work-body{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;}
.patient-work-body .table-wrap{flex:1;min-width:260px;}
.tooth-chart-wrap{flex:0 0 auto;background:#FAFAFA;border-radius:10px;padding:6px;}
@media(max-width:480px){.app-header h1{font-size:13px;}.kv-grid{grid-template-columns:1fr 1fr;}thead tr th,tbody tr td{font-size:11px;padding:6px 7px;}.patient-work-body{flex-direction:column;}}
CSS;
    }

    protected function js(): string
    {
        return <<<'JS'
(function(){
  var searchInput = document.getElementById('search-input');
  var noResult = document.getElementById('no-result');
  function doSearch(q){
    q = q.trim().toLowerCase();
    var rows = document.querySelectorAll('tbody tr');
    var visible = 0;
    rows.forEach(function(row){
      if(!q){ row.style.display=''; visible++; return; }
      var text = row.textContent.toLowerCase();
      if(text.includes(q)){ row.style.display=''; visible++; } else { row.style.display='none'; }
    });
    noResult.style.display = (q && visible===0) ? 'block' : 'none';
  }
  searchInput.addEventListener('input', function(){ doSearch(this.value); });
})();
JS;
    }

    public function buildLocalIndexHtml(string $reportsDir): string
    {
        $files = collect(glob($reportsDir.DIRECTORY_SEPARATOR.'*.html'))
            ->map(fn ($p) => basename($p))
            ->filter(fn ($name) => ! in_array($name, ['index.html', 'sessions.html'], true))
            ->sortDesc()
            ->values();

        $items = $files->map(fn ($f) => '<li><a href="'.$f.'">'.str_replace('.html', '', $f).'</a></li>')->implode('');

        return <<<HTML
<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>تقارير الإغلاق</title>
<style>body{font-family:sans-serif;padding:24px;max-width:500px;margin:0 auto} li{margin:6px 0} a{color:#2563eb;text-decoration:none}</style>
</head>
<body>
<h1>تقارير الإغلاق اليومية (محلي)</h1>
<ul>{$items}</ul>
</body>
</html>
HTML;
    }
}
