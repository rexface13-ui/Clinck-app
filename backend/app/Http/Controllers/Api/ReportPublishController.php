<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TelegramLink;
use App\Services\DailyReportService;
use App\Services\ReportPublishService;
use App\Services\TelegramService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Publishing a generated daily report (docs/reports/*.html, local staging
 * files) is a deliberate, human-clicked action — never automatic. The actual
 * upload goes to a separate, dedicated public repo via ReportPublishService
 * (GitHub Contents API), never touching this app's own repo or working
 * directory — see that class for why.
 */
class ReportPublishController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        $reportsDir = dirname(base_path()).DIRECTORY_SEPARATOR.'docs'.DIRECTORY_SEPARATOR.'reports';
        if (! is_dir($reportsDir)) {
            return ['reports' => []];
        }

        $files = collect(glob($reportsDir.DIRECTORY_SEPARATOR.'*.html'))
            ->map(fn ($p) => basename($p, '.html'))
            ->filter(fn ($name) => $name !== 'index')
            ->sortDesc()
            ->values();

        return ['reports' => $files, 'repo_slug' => env('GITHUB_REPORTS_REPO')];
    }

    public function publish(Request $request, ReportPublishService $publisher)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        $reportsDir = dirname(base_path()).DIRECTORY_SEPARATOR.'docs'.DIRECTORY_SEPARATOR.'reports';
        $files = collect(glob($reportsDir.DIRECTORY_SEPARATOR.'*.html'))
            ->map(fn ($p) => basename($p, '.html'))
            ->filter(fn ($name) => $name !== 'index')
            ->sortDesc();

        $latest = $files->first();
        abort_if(! $latest, 422, 'ما في تقرير مولّد بعد — بيتولّد تلقائياً بالوقت المحدد، أو شغّل report:daily يدوياً.');

        $html = file_get_contents($reportsDir.DIRECTORY_SEPARATOR."{$latest}.html");

        try {
            $url = $publisher->publish($latest, $html);
        } catch (\RuntimeException $e) {
            abort(500, $e->getMessage());
        }

        return ['status' => 'published', 'date' => $latest, 'url' => $url];
    }

    /**
     * The "إغلاق المحل" dashboard button: generate today's report, publish
     * it, publish the full sessions log too, and tell every linked
     * owner/accountant the real links — one click instead of "wait for the
     * schedule, then remember to open Settings and press publish."
     */
    public function closeDay(Request $request, DailyReportService $report, ReportPublishService $publisher, TelegramService $telegram)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        $date = Carbon::today();
        $dateStr = $date->toDateString();
        $html = $report->buildReportHtml($date);

        $reportsDir = dirname(base_path()).DIRECTORY_SEPARATOR.'docs'.DIRECTORY_SEPARATOR.'reports';
        if (! is_dir($reportsDir)) {
            mkdir($reportsDir, 0755, true);
        }
        file_put_contents($reportsDir.DIRECTORY_SEPARATOR."{$dateStr}.html", $html);
        file_put_contents($reportsDir.DIRECTORY_SEPARATOR.'index.html', $report->buildLocalIndexHtml($reportsDir));

        try {
            $reportUrl = $publisher->publish($dateStr, $html);
            $sessionsUrl = $publisher->publishSessionsLog($report->buildSessionsLogHtml());
        } catch (\RuntimeException $e) {
            abort(500, $e->getMessage());
        }

        $recipients = TelegramLink::with('user')
            ->whereNotNull('linked_at')
            ->get()
            ->filter(fn (TelegramLink $l) => $l->user?->hasAnyRole(['owner', 'accountant']));

        foreach ($recipients as $link) {
            $telegram->sendMessage(
                (int) $link->telegram_chat_id,
                "🦷 تم إغلاق المحل ليوم {$dateStr}\nتقرير الإغلاق: {$reportUrl}\nسجل الجلسات الكامل: {$sessionsUrl}",
            );
        }

        return ['status' => 'closed', 'date' => $dateStr, 'report_url' => $reportUrl, 'sessions_url' => $sessionsUrl];
    }
}
