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

        // The owner types a wall-clock time; now() is UTC. Comparing the two
        // directly fires the report hours off — three, here.
        $localNow = now()->timezone(config('dentaflow.display_timezone'));
        $today = $localNow->toDateString();
        $lastRun = Setting::where('key', 'daily_report_last_run_date')->value('value');

        if ($lastRun === $today) {
            return self::SUCCESS;
        }

        // At-or-after, not an exact match: the clinic's PC is not on 24/7, so
        // requiring now() to land exactly on the configured minute means a
        // machine that was asleep at 22:00 never produces that day's report.
        if ($localNow->format('H:i') < $configuredTime) {
            return self::SUCCESS;
        }

        Artisan::call('report:daily');
        Setting::updateOrCreate(['key' => 'daily_report_last_run_date'], ['value' => $today]);

        return self::SUCCESS;
    }
}
