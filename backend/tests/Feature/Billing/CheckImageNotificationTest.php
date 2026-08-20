<?php

namespace Tests\Feature\Billing;

use App\Console\Commands\TelegramNotifyCheckImage;
use App\Models\TelegramLink;
use App\Models\User;
use App\Services\CheckService;
use App\Services\TelegramService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Adding a check with a photo used to freeze the entire app: CheckService
 * ran a blocking loop of Telegram sendPhoto calls (up to 20s each, per
 * recipient) inside the same request that saved the check, and since
 * php artisan serve handles one request at a time, that froze every other
 * user until Telegram answered or timed out.
 *
 * The fix is that receive()/attachImage() never call the Telegram API
 * directly — they launch a detached `telegram:notify-check-image` process
 * and return immediately. This asserts that contract: no outbound Telegram
 * HTTP call happens on the request path, and the check row is saved either
 * way, even if launching the notifier itself throws.
 */
class CheckImageNotificationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // The detached notifier command pins tenancy to local_clinic_id (it
        // runs outside a request). Postgres sequences don't roll back
        // between tests, so the seeded clinic's real id drifts from the
        // fixed config value — point the config at the clinic this test
        // actually seeded, same fix as TelegramScheduleTest.
        config(['dentaflow.local_clinic_id' => CurrentClinic::id(), 'telegram.bot_token' => 'test-token']);
    }

    private function image(): UploadedFile
    {
        Storage::fake('local');

        return UploadedFile::fake()->image('check.jpg', 200, 200);
    }

    public function test_receiving_a_check_with_a_photo_never_calls_telegram_directly(): void
    {
        Process::fake();
        Http::fake(); // any direct call here would mean the freeze bug is back

        $patient = $this->makePatient();

        app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '999',
            bankName: 'بنك تجريبي',
            amount: 500,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
            image: $this->image(),
        );

        Http::assertNothingSent();
        Process::assertRan(fn ($process) => str_contains(implode(' ', $process->command), 'telegram:notify-check-image'));
    }

    public function test_a_slow_or_unreachable_telegram_cannot_block_saving_the_check(): void
    {
        // Launching the detached process itself fails (e.g. process spawn
        // rejected) — the check must still save; the notification is
        // fire-and-forget by design, never allowed to fail the request.
        Process::fake(fn () => throw new \RuntimeException('spawn failed'));

        $patient = $this->makePatient();

        $check = app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '1000',
            bankName: 'بنك تجريبي',
            amount: 500,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
            image: $this->image(),
        );

        $this->assertNotNull($check->id);
        $this->assertDatabaseHas('checks', ['id' => $check->id, 'check_number' => '1000']);
    }

    public function test_a_check_with_no_photo_launches_no_notification_at_all(): void
    {
        Process::fake();
        $patient = $this->makePatient();

        app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '1001',
            bankName: null,
            amount: 200,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
        );

        Process::assertDidntRun(fn ($process) => str_contains(implode(' ', $process->command), 'telegram:notify-check-image'));
    }

    /**
     * requestImage() (the explicit "طلب صورة عبر تيليغرام" button) is a
     * direct action someone is sitting there waiting on, unlike the
     * automatic ping — it must actually report failure instead of always
     * claiming success.
     */
    public function test_requesting_a_check_image_reports_failure_when_telegram_does_not_go_through(): void
    {
        $this->actingAs($this->owner);

        $link = TelegramLink::create(['user_id' => $this->owner->id, 'telegram_chat_id' => 444555666, 'linked_at' => now()]);
        $check = app(CheckService::class)->receive(
            direction: 'incoming', partyType: 'patient', partyId: $this->makePatient()->id,
            checkNumber: '2001', bankName: null, amount: 100, currency: 'ILS', dueDate: now()->addMonth()->toDateString(),
        );

        Http::fake(fn () => Http::response('', 500));

        $this->postJson("/api/checks/{$check->id}/request-image", ['user_id' => $this->owner->id])
            ->assertStatus(422);
    }

    public function test_requesting_a_check_image_succeeds_when_telegram_accepts_it(): void
    {
        $this->actingAs($this->owner);

        $link = TelegramLink::create(['user_id' => $this->owner->id, 'telegram_chat_id' => 444555667, 'linked_at' => now()]);
        $check = app(CheckService::class)->receive(
            direction: 'incoming', partyType: 'patient', partyId: $this->makePatient()->id,
            checkNumber: '2002', bankName: null, amount: 100, currency: 'ILS', dueDate: now()->addMonth()->toDateString(),
        );

        Http::fake(fn () => Http::response(['ok' => true], 200));

        $this->postJson("/api/checks/{$check->id}/request-image", ['user_id' => $this->owner->id])
            ->assertNoContent();
    }

    /** The detached command itself is what actually calls Telegram — covered separately from the request path above. */
    public function test_the_detached_command_sends_the_photo_to_every_linked_owner_and_accountant(): void
    {
        Storage::fake('local');
        config(['telegram.bot_token' => 'test-token']);

        $owner = User::withoutGlobalScopes()->where('username', 'owner')->firstOrFail();
        TelegramLink::create(['user_id' => $owner->id, 'telegram_chat_id' => 111222333, 'linked_at' => now()]);

        $patient = $this->makePatient();
        $check = app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '1002',
            bankName: null,
            amount: 200,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
        );
        // Attach the image outside receive() so this test controls exactly
        // when the notifier runs, instead of racing the detached process.
        $imagePath = UploadedFile::fake()->image('check.jpg')->store('checks', 'local');

        $sent = [];
        Http::fake(function ($request) use (&$sent) {
            $sent[] = $request->url();

            return Http::response(['ok' => true], 200);
        });

        Artisan::call(TelegramNotifyCheckImage::class, ['checkId' => $check->id, 'imagePath' => $imagePath]);

        $this->assertNotEmpty($sent);
        $this->assertStringContainsString('sendPhoto', $sent[0]);
    }
}
