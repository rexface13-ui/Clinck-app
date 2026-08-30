<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ReportPublishService;
use Illuminate\Http\Request;

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
}
