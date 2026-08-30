<?php

namespace App\Console\Commands;

use App\Models\TelegramLink;
use App\Services\DailyReportService;
use App\Services\TelegramService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class GenerateDailyReport extends Command
{
    protected $signature = 'report:daily {date?}';

    protected $description = 'Generates the daily closing report as a static HTML page under docs/reports — publishing (git push) is a separate manual step from Settings';

    public function handle(TelegramService $telegram, DailyReportService $report): int
    {
        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        $date = $this->argument('date') ? Carbon::parse($this->argument('date')) : Carbon::today();
        $dateStr = $date->toDateString();

        $this->info("توليد تقرير الإغلاق ليوم {$dateStr}...");

        $html = $report->buildReportHtml($date);

        $repoRoot = dirname(base_path());
        $reportsDir = $repoRoot.DIRECTORY_SEPARATOR.'docs'.DIRECTORY_SEPARATOR.'reports';
        if (! is_dir($reportsDir)) {
            mkdir($reportsDir, 0755, true);
        }

        file_put_contents($reportsDir.DIRECTORY_SEPARATOR."{$dateStr}.html", $html);
        file_put_contents($reportsDir.DIRECTORY_SEPARATOR.'index.html', $report->buildLocalIndexHtml($reportsDir));

        $recipients = TelegramLink::with('user')
            ->whereNotNull('linked_at')
            ->get()
            ->filter(fn (TelegramLink $l) => $l->user?->hasAnyRole(['owner', 'accountant']));

        foreach ($recipients as $link) {
            $telegram->sendMessage(
                (int) $link->telegram_chat_id,
                "📊 تقرير إغلاق يوم {$dateStr} جاهز محلياً — روح لصفحة الإعدادات واضغط \"نشر آخر تقرير\" عشان يصير عالرابط، أو استخدم زر \"إغلاق المحل\" بالصفحة الرئيسية لتوليد ونشر بضغطة وحدة.",
            );
        }

        $this->info('تم التوليد. النشر (رفعه عالرابط) خطوة يدوية منفصلة من صفحة الإعدادات، أو زر "إغلاق المحل" بالداشبورد.');

        return self::SUCCESS;
    }
}
