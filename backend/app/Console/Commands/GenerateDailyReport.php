<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\CheckModel;
use App\Models\Expense;
use App\Models\Income;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Models\Setting;
use App\Models\SupplierTransaction;
use App\Models\TelegramLink;
use App\Services\TelegramService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class GenerateDailyReport extends Command
{
    protected $signature = 'report:daily {date?}';

    protected $description = 'Generates the daily closing report as a static HTML page under docs/reports — publishing (git push) is a separate manual step from Settings';

    // Same palette as the Dazzling closing-report generator this design is modeled on.
    protected const C_GREEN = '#1D9E75';

    protected const C_BLUE = '#185FA5';

    protected const C_RED = '#EF4444';

    protected const C_AMBER = '#F59E0B';

    protected const C_GRAY = '#F3F4F6';

    protected const C_MGRAY = '#9CA3AF';

    protected const C_DARK = '#1F2937';

    public function handle(TelegramService $telegram): int
    {
        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        $date = $this->argument('date') ? Carbon::parse($this->argument('date')) : Carbon::today();
        $dateStr = $date->toDateString();

        $this->info("توليد تقرير الإغلاق ليوم {$dateStr}...");

        $html = $this->buildReportHtml($date);

        $repoRoot = dirname(base_path());
        $reportsDir = $repoRoot.DIRECTORY_SEPARATOR.'docs'.DIRECTORY_SEPARATOR.'reports';
        if (! is_dir($reportsDir)) {
            mkdir($reportsDir, 0755, true);
        }

        file_put_contents($reportsDir.DIRECTORY_SEPARATOR."{$dateStr}.html", $html);
        file_put_contents($reportsDir.DIRECTORY_SEPARATOR.'index.html', $this->buildLocalIndexHtml($reportsDir));

        $recipients = TelegramLink::with('user')
            ->whereNotNull('linked_at')
            ->get()
            ->filter(fn (TelegramLink $l) => $l->user?->hasAnyRole(['owner', 'accountant']));

        foreach ($recipients as $link) {
            $telegram->sendMessage(
                (int) $link->telegram_chat_id,
                "📊 تقرير إغلاق يوم {$dateStr} جاهز محلياً — روح لصفحة الإعدادات واضغط \"نشر آخر تقرير\" عشان يصير عالرابط.",
            );
        }

        $this->info('تم التوليد. النشر (رفعه عالرابط) خطوة يدوية منفصلة من صفحة الإعدادات.');

        return self::SUCCESS;
    }

    protected function buildReportHtml(Carbon $date): string
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

        // ── فواتير/مرضى اليوم بالتفصيل (نفس منطق ReportController::dailyDetail) ──
        $invoices = \App\Models\Invoice::with('patient')
            ->whereBetween('issued_at', [$dayStartUtc, $dayEndUtc])
            ->orderBy('issued_at')
            ->get();
        $revenueIls = (float) $invoices->sum('total_amount_ils');

        // ── حجوزات اليوم ──
        $appointments = Appointment::with(['patient:id,full_name', 'doctor:id,full_name'])
            ->whereBetween('starts_at', [$dayStartUtc, $dayEndUtc])
            ->orderBy('starts_at')
            ->get();

        // ── مرضى جدد اليوم ──
        $newPatients = Patient::whereBetween('created_at', [$dayStartUtc, $dayEndUtc])->get(['id', 'full_name', 'code', 'phone']);

        // ── طرق الدفع (نفس منطق ReportController::collections لهاد اليوم بس) ──
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

        // ── شيكات اليوم (كل الحركة، مو بس الواردة) ──
        $checksToday = CheckModel::whereDate('received_at', $dateStr)->get();

        // ── أرصدة الصناديق ──
        $cashboxes = Cashbox::all();

        // ── ديون المرضى بالتفصيل (نفس منطق ReportController::debtsAging بدون تقسيم لفئات) ──
        $patientDebts = Patient::with(['transactions' => fn ($q) => $q->orderBy('occurred_at')])->get()
            ->map(function (Patient $p) {
                $balance = $p->transactions->reduce(
                    fn ($carry, $t) => $carry + (in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils),
                    0.0
                );

                return ['name' => $p->full_name, 'phone' => $p->phone, 'balance' => round($balance, 2)];
            })
            ->filter(fn ($p) => $p['balance'] > 0.01)
            ->sortByDesc('balance')
            ->values();
        $totalPatientDebt = $patientDebts->sum('balance');

        // ── ديون الموردين بالتفصيل ──
        $supplierDebts = SupplierTransaction::with('supplier:id,name')->get()
            ->groupBy('supplier_id')
            ->map(fn ($rows) => ['name' => $rows->first()->supplier?->name ?? 'مورد محذوف', 'balance' => round((float) $rows->sum('amount_ils'), 2)])
            ->filter(fn ($s) => $s['balance'] > 0.01)
            ->sortByDesc('balance')
            ->values();
        $totalSupplierDebt = $supplierDebts->sum('balance');

        $net = $incomeTotalIls - $expenseTotalIls;

        // ── بناء الأقسام ──
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

        $appointmentsSection = $this->section('حجوزات اليوم', self::C_GREEN, $appointments->isEmpty()
            ? '<p class="empty">لا توجد حجوزات اليوم</p>'
            : $this->dataTable(['الوقت', 'المريض', 'الطبيب', 'الحالة'], $appointments->map(fn (Appointment $a) => [
                Carbon::parse($a->starts_at)->timezone($timezone)->format('H:i'),
                $a->patient?->full_name ?? '—',
                $a->doctor?->full_name ?? '—',
                $this->appointmentStatusLabel($a->status),
            ])->all()));

        $invoicesSection = $this->section('فواتير اليوم', self::C_GREEN, $invoices->isEmpty()
            ? '<p class="empty">لا توجد فواتير اليوم</p>'
            : $this->dataTable(['المريض', 'رقم الفاتورة', 'المبلغ', 'الحالة'], $invoices->map(fn ($i) => [
                $i->patient?->full_name ?? 'مريض محذوف',
                $i->invoice_number,
                $money($i->total_amount_ils).' ₪',
                $this->invoiceStatusLabel($i->status),
            ])->all()));

        $newPatientsSection = $this->section('مرضى جدد اليوم', self::C_BLUE, $newPatients->isEmpty()
            ? '<p class="empty">لا يوجد تسجيل مرضى جدد اليوم</p>'
            : $this->dataTable(['الاسم', 'الكود', 'الهاتف'], $newPatients->map(fn ($p) => [$p->full_name, $p->code, $p->phone ?: '—'])->all(), self::C_BLUE));

        $methodsSection = $this->section('طرق الدفع اليوم', self::C_GREEN, empty($methodTotals)
            ? '<p class="empty">لا يوجد تحصيل اليوم</p>'
            : $this->dataTable(['الطريقة', 'المبلغ'], collect($methodTotals)->map(fn ($v, $m) => [$methodLabels[$m] ?? $m, $money($v).' ₪'])->values()->all()));

        $expensesSection = $this->section('مصاريف اليوم', self::C_RED, $expenses->isEmpty()
            ? '<p class="empty">لا توجد مصاريف اليوم</p>'
            : $this->dataTable(['التصنيف', 'الصندوق', 'المبلغ'], $expenses->map(fn ($e) => [$e->category?->name ?? 'أخرى', $e->cashbox?->name ?? '—', $money($e->amount_ils).' ₪'])->all(), self::C_RED));

        $checksSection = $this->section('شيكات اليوم', self::C_AMBER, $checksToday->isEmpty()
            ? '<p class="empty">لا توجد شيكات اليوم</p>'
            : $this->dataTable(['الاتجاه', 'رقم الشيك', 'المبلغ'], $checksToday->map(fn ($c) => [$c->direction === 'incoming' ? 'وارد' : 'صادر', $c->check_number, $money($c->amount).' '.$c->currency])->all(), self::C_AMBER));

        $cashboxSection = $this->section('أرصدة الصناديق الحالية', self::C_BLUE,
            $this->dataTable(['الصندوق', 'العملة', 'الرصيد'], $cashboxes->map(fn ($c) => [$c->name, $c->currency, $money($c->balance)])->all(), self::C_BLUE));

        $patientDebtsRows = $patientDebts->map(fn ($p) => [$p['name'], $p['phone'] ?: '—', $money($p['balance']).' ₪'])->all();
        if ($patientDebts->isNotEmpty()) {
            $patientDebtsRows[] = ['الإجمالي', '', $money($totalPatientDebt).' ₪'];
        }
        $patientDebtsSection = $this->section('ديون المرضى', self::C_RED, $patientDebts->isEmpty()
            ? '<p class="empty ok">✅ لا توجد ديون على المرضى</p>'
            : $this->dataTable(['المريض', 'الهاتف', 'المستحق'], $patientDebtsRows, self::C_RED));

        $supplierDebtsRows = $supplierDebts->map(fn ($s) => [$s['name'], $money($s['balance']).' ₪'])->all();
        if ($supplierDebts->isNotEmpty()) {
            $supplierDebtsRows[] = ['الإجمالي', $money($totalSupplierDebt).' ₪'];
        }
        $supplierDebtsSection = $this->section('ديون الموردين', self::C_AMBER, $supplierDebts->isEmpty()
            ? '<p class="empty ok">✅ لا توجد ديون للموردين</p>'
            : $this->dataTable(['المورد', 'المستحق'], $supplierDebtsRows, self::C_AMBER));

        $body = $summary.$appointmentsSection.$invoicesSection.$newPatientsSection.$methodsSection
            .$expensesSection.$checksSection.$cashboxSection.$patientDebtsSection.$supplierDebtsSection;

        return $this->wrapPage($clinicName, $date, $body);
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

    // ── PHP port of Dazzling's html_report_generator.py building blocks ──

    protected function kvGrid(array $pairs): string
    {
        $cells = collect($pairs)
            ->map(fn ($p) => '<div class="kv-cell"><span class="kv-label">'.$p[0].'</span><span class="kv-val">'.$p[1].'</span></div>')
            ->implode('');

        return "<div class=\"kv-grid\">{$cells}</div>";
    }

    protected function section(string $title, string $color, string $content): string
    {
        return "<div class=\"section\"><div class=\"section-title\" style=\"background:{$color};\">{$title}</div>{$content}</div>";
    }

    protected function dataTable(array $headers, array $rows, string $color = self::C_GREEN): string
    {
        $th = collect($headers)->map(fn ($h) => "<th>{$h}</th>")->implode('');
        $body = collect($rows)->map(function ($row) {
            $td = collect($row)->map(fn ($cell) => "<td>{$cell}</td>")->implode('');

            return "<tr>{$td}</tr>";
        })->implode('');

        return "<div class=\"table-wrap\"><table><thead style=\"background:{$color};\"><tr>{$th}</tr></thead><tbody>{$body}</tbody></table></div>";
    }

    protected function wrapPage(string $clinicName, Carbon $date, string $body): string
    {
        $dateStr = $date->format('d/m/Y');
        $css = $this->css();
        $js = $this->js();

        return <<<HTML
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير الإغلاق — {$clinicName} — {$dateStr}</title>
<style>{$css}</style>
</head>
<body>
<header class="app-header">
  <h1>📊 تقرير الإغلاق اليومي — {$clinicName}</h1>
  <span class="app-date">{$dateStr}</span>
</header>
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
        $dark = self::C_DARK;
        $mgray = self::C_MGRAY;
        $gray = self::C_GRAY;

        return <<<CSS
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;background:#F0F2F5;color:{$dark};direction:rtl;font-size:14px;}
.app-header{background:{$green};padding:14px 16px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.2);}
.app-header h1{color:#fff;font-size:16px;flex:1;}
.app-date{color:rgba(255,255,255,.8);font-size:12px;white-space:nowrap;}
.search-bar{padding:10px 16px;background:#fff;border-bottom:1px solid #E5E7EB;position:sticky;top:52px;z-index:99;}
.search-bar input{width:100%;padding:9px 12px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;outline:none;direction:rtl;}
.search-bar input:focus{border-color:{$green};}
.content{padding:12px;}
.section{background:#fff;border-radius:10px;margin-bottom:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07);}
.section-title{padding:10px 14px;color:#fff;font-size:14px;font-weight:600;}
.kv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;padding:12px;margin-bottom:12px;}
.kv-cell{background:#fff;border-radius:8px;padding:10px 12px;box-shadow:0 1px 3px rgba(0,0,0,.08);}
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
@media(max-width:480px){.app-header h1{font-size:13px;}.kv-grid{grid-template-columns:1fr 1fr;}thead tr th,tbody tr td{font-size:11px;padding:6px 7px;}}
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

    protected function buildLocalIndexHtml(string $reportsDir): string
    {
        $files = collect(glob($reportsDir.DIRECTORY_SEPARATOR.'*.html'))
            ->map(fn ($p) => basename($p))
            ->filter(fn ($name) => $name !== 'index.html')
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
