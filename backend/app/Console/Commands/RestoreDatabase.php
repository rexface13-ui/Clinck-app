<?php

namespace App\Console\Commands;

use App\Support\ProcessEnv;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

class RestoreDatabase extends Command
{
    protected $signature = 'backup:restore {file : Filename inside storage/app/backups, or an absolute path} {--force : Skip the confirmation prompt}';

    protected $description = 'Restore the database from a pg_dump custom-format backup — DESTROYS current data';

    public function handle(): int
    {
        $file = $this->argument('file');
        $path = str_contains($file, DIRECTORY_SEPARATOR) || str_contains($file, '/')
            ? $file
            : storage_path('app'.DIRECTORY_SEPARATOR.'backups'.DIRECTORY_SEPARATOR.$file);

        if (! is_file($path)) {
            $this->error("Backup file not found: {$path}");

            return self::FAILURE;
        }

        if (! $this->option('force') && ! $this->confirm('This will ERASE all current data and replace it with the backup. Continue?')) {
            return self::FAILURE;
        }

        $config = config('database.connections.pgsql');
        $uri = sprintf(
            'postgresql://%s:%s@%s:%s/%s',
            rawurlencode($config['username']),
            rawurlencode($config['password']),
            $config['host'],
            $config['port'],
            $config['database'],
        );

        $result = Process::timeout(300)
            ->env(ProcessEnv::withOverrides())
            ->run([
                config('dentaflow.pg_restore_path'),
                '--dbname='.$uri,
                '--clean',
                '--if-exists',
                '--no-owner',
                $path,
            ]);

        // pg_restore exits non-zero on cosmetic warnings (e.g. "role does not
        // exist" for --no-owner) even when the restore itself succeeded, so
        // surface stderr but don't treat it alone as failure.
        if ($result->failed() && ! str_contains($result->errorOutput(), 'WARNING')) {
            $this->error('Restore failed: '.$result->errorOutput());

            return self::FAILURE;
        }

        $this->info('Database restored from '.basename($path));

        return self::SUCCESS;
    }
}
