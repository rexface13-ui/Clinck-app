<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('telegram:send-reminders')->dailyAt('08:00');

// The report time is owner-configurable from Settings (daily_report_time),
// so it can't be a fixed ->dailyAt() — this checks every minute whether
// "now" matches the configured time and hasn't already fired today.
Schedule::command('report:check-schedule')->everyMinute();
