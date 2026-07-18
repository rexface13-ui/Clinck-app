<?php

namespace App\Console\Commands;

use App\Support\ProcessEnv;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;

class BackupDatabase extends Command
{
    protected $signature = 'backup:create';

    protected $description = 'Dump the database to storage/app/backups (pg_dump custom format)';

    public function handle(): int
    {
        $dir = storage_path('app'.DIRECTORY_SEPARATOR.'backups');
        File::ensureDirectoryExists($dir);

        $filename = 'dentaflow_'.now()->format('Y-m-d_His').'.dump';
        $path = $dir.DIRECTORY_SEPARATOR.$filename;

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
                config('dentaflow.pg_dump_path'),
                '--dbname='.$uri,
                '--format=custom',
                '--file='.$path,
            ]);

        if ($result->failed()) {
            $this->error('Backup failed: '.$result->errorOutput());

            return self::FAILURE;
        }

        $this->info("Backup created: {$filename} (".round(filesize($path) / 1024, 1).' KB)');

        return self::SUCCESS;
    }
}
