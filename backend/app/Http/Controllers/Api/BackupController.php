<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\ProcessEnv;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;

class BackupController extends Controller
{
    protected function requireSettingsManage(Request $request): void
    {
        abort_unless($request->user()->can('settings.manage'), 403);
    }

    protected function backupsDir(): string
    {
        $dir = storage_path('app'.DIRECTORY_SEPARATOR.'backups');
        File::ensureDirectoryExists($dir);

        return $dir;
    }

    /**
     * Runs artisan as a brand-new process rather than in-process
     * Artisan::call(). pg_dump/pg_restore spawned as a grandchild of the
     * `artisan serve` dev server fail silently on Windows (empty libpq
     * error) — a fresh top-level php.exe process doesn't have that problem.
     */
    protected function runArtisan(array $args): \Illuminate\Process\ProcessResult
    {
        // Symfony Process needs a writable temp dir for its output-capture
        // files; under artisan serve, TEMP/TMP aren't inherited and it
        // falls back to C:\Windows (not writable by a regular user).
        $tmpDir = storage_path('app'.DIRECTORY_SEPARATOR.'tmp');
        File::ensureDirectoryExists($tmpDir);

        return Process::timeout(300)
            ->path(base_path())
            ->env(ProcessEnv::withOverrides(['TEMP' => $tmpDir, 'TMP' => $tmpDir]))
            ->run([
                PHP_BINARY,
                'artisan',
                ...$args,
            ]);
    }

    public function index(Request $request)
    {
        $this->requireSettingsManage($request);

        $files = collect(File::files($this->backupsDir()))
            ->sortByDesc(fn ($f) => $f->getMTime())
            ->map(fn ($f) => [
                'name' => $f->getFilename(),
                'size_kb' => round($f->getSize() / 1024, 1),
                'created_at' => display_datetime(date('Y-m-d H:i:s', $f->getMTime())),
            ])
            ->values();

        return $files;
    }

    public function store(Request $request)
    {
        $this->requireSettingsManage($request);

        $result = $this->runArtisan(['backup:create']);
        $output = $result->output().$result->errorOutput();

        if (! str_contains($output, 'Backup created')) {
            return response()->json(['message' => 'فشل إنشاء النسخة الاحتياطية.', 'detail' => $output], 500);
        }

        return response()->json(['message' => trim($output)]);
    }

    public function download(Request $request, string $filename)
    {
        $this->requireSettingsManage($request);

        $path = $this->backupsDir().DIRECTORY_SEPARATOR.basename($filename);
        abort_unless(is_file($path), 404);

        return response()->download($path);
    }

    public function restore(Request $request)
    {
        $this->requireSettingsManage($request);

        $request->validate([
            'file' => ['required', 'file', 'max:512000', 'extensions:dump'], // 500MB
        ]);

        $upload = $request->file('file');
        $tempName = 'restore_'.Str::random(8).'.dump';
        $tempPath = $this->backupsDir().DIRECTORY_SEPARATOR.$tempName;
        $upload->move($this->backupsDir(), $tempName);

        $result = $this->runArtisan(['backup:restore', $tempPath, '--force']);
        $output = $result->output().$result->errorOutput();

        File::delete($tempPath);

        if (! str_contains($output, 'restored')) {
            return response()->json(['message' => 'فشل الاستعادة.', 'detail' => $output], 500);
        }

        return response()->json(['message' => trim($output)]);
    }
}
