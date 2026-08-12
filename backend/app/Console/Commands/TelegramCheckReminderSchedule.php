<?php

namespace App\Console\Commands;

use App\Models\Setting;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

class TelegramCheckReminderSchedule extends Command
{
    protected $signature = 'telegram:check-reminder-schedule';

    protected $description = 'Runs every minute; fires telegram:send-reminders once per day at the owner-configured time (reminder_time setting)';

    public const DEFAULT_TIME = '08:00';

    public function handle(): int
    {
        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        $configured = Setting::where('key', 'reminder_time')->value('value') ?: self::DEFAULT_TIME;

        // The owner types a wall-clock time; now() is UTC. Comparing the two
        // directly fires the reminders hours off — three, here.
        $localNow = now()->timezone(config('dentaflow.display_timezone'));
        $today = $localNow->toDateString();

        if (Setting::where('key', 'reminder_last_run_date')->value('value') === $today) {
            return self::SUCCESS;
        }

        // At-or-after, not an exact match: the clinic's PC is not on 24/7, so
        // requiring now() to land exactly on the configured minute means a
        // machine booted at 09:00 never sends that day's reminders at all.
        if ($localNow->format('H:i') < $configured) {
            return self::SUCCESS;
        }

        Artisan::call('telegram:send-reminders');
        Setting::updateOrCreate(['key' => 'reminder_last_run_date'], ['value' => $today]);

        return self::SUCCESS;
    }
}
