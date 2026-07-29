<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
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

        $steps = [
            'سحب آخر نسخة من GitHub' => [
                ['git', 'remote', 'set-url', 'origin', $repoUrl],
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

        $migrate = $this->run([$php, 'artisan', 'migrate', '--force'], $backend);
        $log .= $migrate['log'];
        if (! $migrate['ok']) {
            return response()->json(['success' => false, 'log' => $log], 500);
        }

        $log .= "\nتم التحديث بنجاح — أعد تشغيل النظام (سكّر نوافذ Backend/Frontend وشغّل start.bat) عشان يطبّق كامل.";

        return response()->json(['success' => true, 'log' => $log]);
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
