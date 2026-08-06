<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Process;

/**
 * The in-app twin of installer/update.ps1 — git pull + composer install,
 * triggered from the Settings page instead of a .bat file so a non-technical
 * clinic owner doesn't need to find/run a script. Deliberately owner-only
 * (see routes/api.php) since this pulls and executes arbitrary code from the
 * configured repo.
 *
 * It stops short of the database on purpose: migrations are applied by
 * installer/migrate.bat, which asks first and backs up first. See the comment
 * in update() for why.
 */
class SystemUpdateController extends Controller
{
    public function update(Request $request)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        $root = base_path('..');
        $backend = base_path();
        $repo = env('GITHUB_UPDATE_REPO');
        $token = env('GITHUB_UPDATE_TOKEN');

        if (! $repo || ! $token) {
            return response()->json([
                'success' => false,
                'log' => "GITHUB_UPDATE_REPO و/أو GITHUB_UPDATE_TOKEN غير معبّيين بملف .env.\nضيفهم يدوياً قبل استخدام هالزر، أو استخدم installer\\update.bat.",
            ], 422);
        }

        $repoUrl = "https://{$token}@{$repo}";
        $log = '';

        // The shipped ZIP has .git stripped out on purpose (so the embedded
        // token in the deploy repo's history never ends up on a customer's
        // disk) — the first update ever run has no repo to "set-url"/fetch
        // against, so that step silently no-ops instead of erroring and the
        // customer ends up with a half-updated install (e.g. index.html
        // pointing at asset files that were never actually pulled). Bootstrap
        // the repo locally on first run instead of assuming it exists.
        $gitSteps = is_dir($root.'\\.git')
            ? [['git', 'remote', 'set-url', 'origin', $repoUrl]]
            : [['git', 'init', '-q'], ['git', 'remote', 'add', 'origin', $repoUrl]];

        $steps = [
            'سحب آخر نسخة من GitHub' => [
                ...$gitSteps,
                ['git', 'fetch', 'origin'],
                ['git', 'reset', '--hard', 'origin/main'],
            ],
        ];

        foreach ($steps['سحب آخر نسخة من GitHub'] as $cmd) {
            $result = $this->run($cmd, $root);
            $log .= $result['log'];
            if (! $result['ok']) {
                Log::warning('System update failed during git step', ['cmd' => $cmd]);

                return response()->json(['success' => false, 'log' => $log], 500);
            }
        }

        $phpBinary = base_path('..\\php83\\php.exe');
        $php = file_exists($phpBinary) ? $phpBinary : PHP_BINARY;
        // composer.phar lives at the deploy root (next to php83\), not
        // inside backend\ — same layout install.ps1/update.ps1 expect.
        $composerPhar = base_path('..\\composer.phar');

        $composer = $this->run([$php, $composerPhar, 'install', '--no-dev', '--optimize-autoloader', '--no-interaction'], $backend);
        $log .= $composer['log'];
        if (! $composer['ok']) {
            return response()->json(['success' => false, 'log' => $log], 500);
        }

        // This button deliberately stops at the code. Pulling code is undone by
        // pulling an older version; changing data is not — a repair migration
        // that corrects old rows has no meaningful way back, since its down()
        // would only put the broken state back. So the database is left alone
        // and migrate.bat applies it instead: it shows what is about to run,
        // asks out loud, takes a backup, and refuses to continue without one.
        // Nobody should be able to reshape a clinic's data by clicking a button
        // and walking away.
        // artisan exits 0 whether or not anything is pending, and the word
        // "pending" appears in "No pending migrations." too — so the only
        // reliable signal is that sentence itself.
        $pending = $this->run([$php, 'artisan', 'migrate:status', '--pending'], $backend);
        $hasPending = $pending['ok'] && ! str_contains($pending['log'], 'No pending migrations');

        $log .= "\nتم تحديث الكود. قاعدة البيانات ما انلمست.\n";

        if ($hasPending) {
            $log .= $pending['log'];
            $log .= "\n⚠️ في تحديثات لقاعدة البيانات لسا ما انطبقت.\n"
                .'سكّر النظام وشغّل installer\\migrate.bat لتطبيقها — بياخد نسخة احتياطية قبل ما يبدأ. '
                ."النظام ممكن ما يشتغل صح قبل ما تطبّقها.";
        } else {
            $log .= "\nما في تحديثات لقاعدة البيانات — سكّر النظام وشغّل start.bat.";
        }

        return response()->json([
            'success' => true,
            'needs_migration' => $hasPending,
            'log' => $log,
        ]);
    }

    /** @param string[] $cmd */
    private function run(array $cmd, string $cwd): array
    {
        $process = new Process($cmd, $cwd);
        $process->setTimeout(300);
        $process->run();

        $label = implode(' ', array_map(fn ($p) => str_contains($p, '@') ? '[hidden-token-url]' : $p, $cmd));
        $out = "\$ {$label}\n" . $process->getOutput() . $process->getErrorOutput() . "\n";

        return ['ok' => $process->isSuccessful(), 'log' => $out];
    }
}
