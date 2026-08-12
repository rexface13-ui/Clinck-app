<?php

namespace App\Console\Commands;

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
        file_put_contents($reportsDir.DIRECTORY_SEPARATOR.'index.html', $this->buildIndexHtml($reportsDir));

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

        $this->info('تم التوليد. النشر (git push) خطوة يدوية منفصلة من صفحة الإعدادات.');

        return self::SUCCESS;
    }

    protected function buildReportHtml(Carbon $date): string
    {
        $dateStr = $date->toDateString();
        $clinicName = Setting::where('key', 'clinic_name')->value('value') ?? 'DentaFlow';

        // Same "unified income" convention as IncomeController::index —
        // manual entries plus patient payment collections.
        $incomeTx = CashboxTransaction::with('cashbox')
            ->whereIn('type', ['income_in', 'payment_in'])
            ->whereDate('occurred_at', $dateStr)
            ->get();

        $incomesById = Income::whereIn('id', $incomeTx->where('type', 'income_in')->pluck('reference_id'))->get()->keyBy('id');
        $paymentsById = Payment::with('patient')->whereIn('id', $incomeTx->where('type', 'payment_in')->pluck('reference_id'))->get()->keyBy('id');

        $incomeRows = $incomeTx->map(function ($t) use ($incomesById, $paymentsById) {
            if ($t->type === 'income_in') {
                $income = $incomesById->get($t->reference_id);

                return ['label' => $income?->description ?: 'وارد يدوي', 'cashbox' => $t->cashbox->name, 'amount' => (float) $t->amount, 'currency' => $t->cashbox->currency];
            }
            $payment = $paymentsById->get($t->reference_id);

            return ['label' => 'تحصيل من '.($payment?->patient?->full_name ?? 'مريض محذوف'), 'cashbox' => $t->cashbox->name, 'amount' => (float) $t->amount, 'currency' => $t->cashbox->currency];
        });
        $incomeTotalIls = $incomeTx->sum(fn ($t) => $t->type === 'income_in' ? (float) ($incomesById->get($t->reference_id)?->amount_ils ?? $t->amount) : (float) ($paymentsById->get($t->reference_id)?->amount_ils ?? $t->amount));

        $expenses = Expense::with('cashbox', 'category')->whereDate('spent_at', $dateStr)->get();
        $expenseTotalIls = $expenses->sum('amount_ils');

        $checks = CheckModel::whereDate('received_at', $dateStr)->get();

        $newPatients = Patient::whereDate('created_at', $dateStr)->count();

        $totalPatientDebt = PatientTransaction::selectRaw("SUM(CASE WHEN type IN ('charge','adjustment') THEN amount_ils ELSE -amount_ils END) as balance")->value('balance') ?? 0;
        $totalSupplierDebt = SupplierTransaction::sum('amount_ils');

        $cashboxes = Cashbox::all();

        $money = fn ($n) => number_format((float) $n, 2);

        $incomeRowsHtml = $incomeRows->isEmpty()
            ? '<tr><td colspan="3" class="muted">لا يوجد وارد اليوم</td></tr>'
            : $incomeRows->map(fn ($r) => "<tr><td>{$r['label']}</td><td>{$r['cashbox']}</td><td>{$money($r['amount'])} {$r['currency']}</td></tr>")->implode('');

        $expenseRowsHtml = $expenses->isEmpty()
            ? '<tr><td colspan="3" class="muted">لا توجد مصاريف اليوم</td></tr>'
            : $expenses->map(fn ($e) => "<tr><td>{$e->category->name}</td><td>{$e->cashbox->name}</td><td>{$money($e->amount)} {$e->currency}</td></tr>")->implode('');

        $checksRowsHtml = $checks->isEmpty()
            ? '<tr><td colspan="3" class="muted">لا توجد شيكات اليوم</td></tr>'
            : $checks->map(fn ($c) => '<tr><td>'.($c->direction === 'incoming' ? 'وارد' : 'صادر')."</td><td>{$c->check_number}</td><td>{$money($c->amount)} {$c->currency}</td></tr>")->implode('');

        $cashboxRowsHtml = $cashboxes->map(fn ($c) => "<tr><td>{$c->name}</td><td>{$c->currency}</td><td>{$money($c->balance)}</td></tr>")->implode('');

        $net = $incomeTotalIls - $expenseTotalIls;
        $netClass = $net >= 0 ? 'positive' : 'negative';

        return <<<HTML
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>تقرير الإغلاق — {$dateStr}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Tahoma, sans-serif; background:#f4f5f7; color:#1f2430; margin:0; padding:24px; }
  .wrap { max-width:760px; margin:0 auto; }
  h1 { font-size:20px; margin-bottom:4px; }
  .sub { color:#6b7280; font-size:13px; margin-bottom:24px; }
  .card { background:#fff; border-radius:12px; padding:16px 20px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  .card h2 { font-size:14px; color:#374151; margin:0 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  td { padding:6px 4px; border-bottom:1px solid #f0f1f3; }
  .muted { color:#9ca3af; text-align:center; }
  .totals { display:flex; gap:12px; flex-wrap:wrap; }
  .stat { flex:1; min-width:140px; background:#f9fafb; border-radius:10px; padding:12px; text-align:center; }
  .stat b { display:block; font-size:18px; margin-top:4px; }
  .positive { color:#16a34a; }
  .negative { color:#dc2626; }
</style>
</head>
<body>
<div class="wrap">
  <h1>تقرير الإغلاق اليومي</h1>
  <p class="sub">{$clinicName} — {$date->format('d/m/Y')}</p>

  <div class="card">
    <div class="totals">
      <div class="stat">الوارد<b class="positive">{$money($incomeTotalIls)} ₪</b></div>
      <div class="stat">المصاريف<b class="negative">{$money($expenseTotalIls)} ₪</b></div>
      <div class="stat">الصافي<b class="{$netClass}">{$money($net)} ₪</b></div>
      <div class="stat">مرضى جدد<b>{$newPatients}</b></div>
    </div>
  </div>

  <div class="card">
    <h2>الوارد اليوم</h2>
    <table>{$incomeRowsHtml}</table>
  </div>

  <div class="card">
    <h2>المصاريف اليوم</h2>
    <table>{$expenseRowsHtml}</table>
  </div>

  <div class="card">
    <h2>شيكات اليوم</h2>
    <table>{$checksRowsHtml}</table>
  </div>

  <div class="card">
    <h2>أرصدة الصناديق الحالية</h2>
    <table>{$cashboxRowsHtml}</table>
  </div>

  <div class="card">
    <div class="totals">
      <div class="stat">إجمالي ديون المرضى<b>{$money($totalPatientDebt)} ₪</b></div>
      <div class="stat">إجمالي مستحق للموردين<b>{$money($totalSupplierDebt)} ₪</b></div>
    </div>
  </div>
</div>
</body>
</html>
HTML;
    }

    protected function buildIndexHtml(string $reportsDir): string
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
<h1>تقارير الإغلاق اليومية</h1>
<ul>{$items}</ul>
</body>
</html>
HTML;
    }
}
