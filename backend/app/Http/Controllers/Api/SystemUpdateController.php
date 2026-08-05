<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\ProcessEnv;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process as LaravelProcess;
use Symfony\Component\Process\Process;

/**
 * The in-app twin of installer/update.ps1 — same steps (git pull, composer
 * install, migrate), triggered from the Settings page instead of a .bat
 * file so a non-technical clinic owner doesn't need to find/run a script.
 * Deliberately owner-only (see routes/api.php) since this pulls and
 * executes arbitrary code from the configured repo.
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

        // Migrations run before anyone has looked at the result, and a repair
        // migration that corrects old rows has no meaningful way back — its
        // down() would only put the broken state back. So take a snapshot
        // first, and refuse to migrate at all if we couldn't: an update that
        // stops before touching the data is recoverable, one that doesn't
        // isn't.
        $backup = $this->runBackup();
        $log .= $backup['log'];
        if (! $backup['ok']) {
            $log .= "\nما قدرنا ناخد نسخة احتياطية قبل تحديث قاعدة البيانات، فوقّفنا التحديث قبل ما نلمس أي بيانات. الكود انسحب بس القاعدة زي ما هي — خد نسخة يدوية من صفحة النسخ الاحتياطي وجرّب كمان مرة.";

            return response()->json(['success' => false, 'log' => $log], 500);
        }

        $migrate = $this->run([$php, 'artisan', 'migrate', '--force'], $backend);
        $log .= $migrate['log'];
        if (! $migrate['ok']) {
            $log .= "\nفشل تحديث قاعدة البيانات. في نسخة احتياطية انأخذت للتو قبل المحاولة — فيك ترجعلها من صفحة النسخ الاحتياطي.";

            return response()->json(['success' => false, 'log' => $log], 500);
        }

        $log .= "\nتم التحديث بنجاح — أعد تشغيل النظام (سكّر نوافذ Backend/Frontend وشغّل start.bat) عشان يطبّق كامل.";

        return response()->json(['success' => true, 'log' => $log]);
    }

    /** @param string[] $cmd */
    /**
     * The pre-update backup, run exactly the way BackupController runs it.
     *
     * Not via run(): spawning php.exe from php.exe while inheriting the full
     * parent environment dies with "Opcode handlers are unusable due to ASLR"
     * before backup:create gets a chance to do anything. Laravel's Process
     * facade with an explicitly narrowed environment (ProcessEnv) is the
     * combination that actually produces a dump — verified against the real
     * database, not assumed.
     */
    private function runBackup(): array
    {
        $tmpDir = storage_path('app'.DIRECTORY_SEPARATOR.'tmp');
        File::ensureDirectoryExists($tmpDir);

        $result = LaravelProcess::timeout(300)
            ->path(base_path())
            ->env(ProcessEnv::withOverrides(['TEMP' => $tmpDir, 'TMP' => $tmpDir]))
            ->run([PHP_BINARY, 'artisan', 'backup:create']);

        $log = "\$ artisan backup:create\n".$result->output().$result->errorOutput()."\n";

        return ['ok' => str_contains($log, 'Backup created'), 'log' => $log];
    }

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
