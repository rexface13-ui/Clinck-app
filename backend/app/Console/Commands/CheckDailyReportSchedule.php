<?php

namespace App\Console\Commands;

use App\Models\Setting;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

class CheckDailyReportSchedule extends Command
{
    protected $signature = 'report:check-schedule';

    protected $description = 'Runs every minute; fires report:daily once per day at the owner-configured time (daily_report_time setting)';

    public function handle(): int
    {
        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        $configuredTime = Setting::where('key', 'daily_report_time')->value('value') ?? '22:00';
        $today = now()->toDateString();
        $lastRun = Setting::where('key', 'daily_report_last_run_date')->value('value');

        if ($lastRun === $today) {
            return self::SUCCESS;
        }

        if (now()->format('H:i') !== $configuredTime) {
            return self::SUCCESS;
        }

        Artisan::call('report:daily');
        Setting::updateOrCreate(['key' => 'daily_report_last_run_date'], ['value' => $today]);

        return self::SUCCESS;
    }
}
