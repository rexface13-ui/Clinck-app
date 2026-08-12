<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// The reminder time is owner-configurable from Settings (reminder_time), so
// it can't be a fixed ->dailyAt() either — same pattern as the daily report.
Schedule::command('telegram:check-reminder-schedule')->everyMinute();

// The report time is owner-configurable from Settings (daily_report_time),
// so it can't be a fixed ->dailyAt() — this checks every minute whether
// "now" matches the configured time and hasn't already fired today.
Schedule::command('report:check-schedule')->everyMinute();
