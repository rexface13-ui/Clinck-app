<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Process;

/**
 * Publishing the generated daily reports (docs/reports/*.html) is a
 * deliberate, human-clicked action — never automatic — since it pushes to
 * the same (public) GitHub repo this app's code lives in.
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

        return ['reports' => $files, 'repo_slug' => config('dentaflow.report_repo_slug')];
    }

    public function publish(Request $request)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        $repoRoot = dirname(base_path());

        $add = Process::path($repoRoot)->run(['git', 'add', 'docs/reports']);
        if (! $add->successful()) {
            abort(500, 'git add فشل: '.$add->errorOutput());
        }

        $commit = Process::path($repoRoot)->run(['git', 'commit', '-m', 'Publish daily closing report(s)']);
        $nothingToCommit = str_contains($commit->output().$commit->errorOutput(), 'nothing to commit');
        if (! $commit->successful() && ! $nothingToCommit) {
            abort(500, 'git commit فشل: '.$commit->errorOutput());
        }

        $push = Process::path($repoRoot)->timeout(60)->run(['git', 'push', 'origin', 'HEAD']);
        if (! $push->successful()) {
            abort(500, 'git push فشل: '.$push->errorOutput());
        }

        return ['status' => $nothingToCommit ? 'already_published' : 'published'];
    }
}
