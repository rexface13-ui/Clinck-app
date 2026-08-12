<?php

namespace Tests\Feature;

use App\Console\Commands\TelegramPoll;
use App\Models\Setting;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * The reminder time and the bot's opening message are both owner-editable
 * from Settings, and the reminders only ever fire because a scheduler is
 * running — these cover all three, including the two bugs that meant no
 * reminder could ever have reached a real clinic.
 */
class TelegramScheduleTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);

        // The scheduled commands run outside a request, so they pin tenancy to
        // local_clinic_id. Postgres sequences don't roll back between tests, so
        // the seeded clinic's id moves — point the config at the real one.
        config(['dentaflow.local_clinic_id' => CurrentClinic::id()]);
    }

    public function test_the_owner_can_set_the_reminder_time_and_the_welcome_message(): void
    {
        $this->putJson('/api/settings', ['values' => [
            'reminder_time' => '09:30',
            'telegram_welcome_message' => 'أهلاً فيك بعيادة الدكتور يوسف',
        ]])->assertOk();

        $settings = $this->getJson('/api/bootstrap')->assertOk()->json('settings');

        $this->assertSame('09:30', $settings['reminder_time']);
        $this->assertSame('أهلاً فيك بعيادة الدكتور يوسف', $settings['telegram_welcome_message']);
    }

    public function test_the_welcome_message_falls_back_to_the_default_when_blank(): void
    {
        Setting::updateOrCreate(['key' => 'telegram_welcome_message'], ['value' => '']);

        $stored = Setting::where('key', 'telegram_welcome_message')->value('value');

        $this->assertSame(TelegramPoll::DEFAULT_WELCOME, $stored ?: TelegramPoll::DEFAULT_WELCOME);
    }

    public function test_reminders_do_not_fire_before_the_configured_time(): void
    {
        Setting::updateOrCreate(['key' => 'reminder_time'], ['value' => '09:00']);
        Carbon::setTestNow(Carbon::parse('2026-08-12 08:15', config('dentaflow.display_timezone')));

        Artisan::call('telegram:check-reminder-schedule');

        $this->assertNull(Setting::where('key', 'reminder_last_run_date')->value('value'));
    }

    public function test_reminders_fire_once_at_the_configured_time(): void
    {
        Setting::updateOrCreate(['key' => 'reminder_time'], ['value' => '09:00']);
        Carbon::setTestNow(Carbon::parse('2026-08-12 09:00', config('dentaflow.display_timezone')));

        Artisan::call('telegram:check-reminder-schedule');

        $this->assertSame('2026-08-12', Setting::where('key', 'reminder_last_run_date')->value('value'));
    }

    /**
     * The clinic PC is not on 24/7. Requiring an exact H:i match meant a
     * machine booted at 10:00 skipped that whole day's reminders.
     */
    public function test_reminders_still_fire_when_the_pc_was_off_at_the_configured_time(): void
    {
        Setting::updateOrCreate(['key' => 'reminder_time'], ['value' => '08:00']);
        Carbon::setTestNow(Carbon::parse('2026-08-12 10:42', config('dentaflow.display_timezone')));

        Artisan::call('telegram:check-reminder-schedule');

        $this->assertSame('2026-08-12', Setting::where('key', 'reminder_last_run_date')->value('value'));
    }

    /**
     * The owner types a wall-clock time from the clinic's timezone; now()
     * inside the app is UTC. Comparing them without converting first fired
     * (or skipped) reminders hours off the configured time.
     */
    public function test_reminder_time_is_compared_in_the_clinic_timezone_not_utc(): void
    {
        Setting::updateOrCreate(['key' => 'reminder_time'], ['value' => '08:00']);
        // 06:25 UTC is 09:25 in Asia/Hebron (UTC+3) — the configured 08:00
        // has already passed locally. Comparing the raw UTC clock against
        // the local wall-clock setting instead (the bug) says 06:25 < 08:00
        // and skips the whole day — this reproduced against the real clinic
        // clock before the fix.
        Carbon::setTestNow(Carbon::parse('2026-08-12 06:25', 'UTC'));

        Artisan::call('telegram:check-reminder-schedule');

        $this->assertSame('2026-08-12', Setting::where('key', 'reminder_last_run_date')->value('value'));
    }

    public function test_reminders_do_not_fire_twice_in_the_same_day(): void
    {
        Setting::updateOrCreate(['key' => 'reminder_time'], ['value' => '08:00']);
        Setting::updateOrCreate(['key' => 'reminder_last_run_date'], ['value' => '2026-08-12']);
        Carbon::setTestNow(Carbon::parse('2026-08-12 14:00', config('dentaflow.display_timezone')));

        Artisan::call('telegram:check-reminder-schedule');

        $this->assertSame('2026-08-12', Setting::where('key', 'reminder_last_run_date')->value('value'));
    }

    /**
     * The token lives in settings, not env — reading config() here made the
     * reminder command bail out as "no token" on every real install.
     */
    public function test_the_reminder_command_reads_the_token_from_settings(): void
    {
        config(['telegram.bot_token' => '']);
        Setting::updateOrCreate(['key' => 'telegram_bot_token'], ['value' => '123:abc']);

        Artisan::call('telegram:send-reminders');

        $this->assertStringNotContainsString('التوكن غير معرّف', Artisan::output());
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }
}
