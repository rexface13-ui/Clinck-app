<?php

namespace Tests\Feature\Clinical;

use App\Console\Commands\TelegramPoll;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\TelegramLink;
use App\Models\ToothFinding;
use App\Services\TelegramService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Support\Facades\Http;
use ReflectionClass;
use Tests\TestCase;

/**
 * A doctor away from the clinic can already search any patient by name from
 * the bot (searchPatientsForDoctor / sendAnyPatientDetailToDoctor); this
 * covers what that lookup now sends back — which teeth are done vs still
 * planned (not just how many), and whether the patient owes money — by
 * driving one real update through handleUpdate with Telegram's HTTP calls
 * faked, the same way the bot actually runs.
 */
class DoctorTelegramPatientLookupTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // handleUpdate() pins tenancy to local_clinic_id (it runs outside a
        // request, no authenticated user to resolve the clinic from).
        // Postgres sequences don't roll back between tests, so the seeded
        // clinic's real id drifts from the fixed config value — point the
        // config at the clinic this test actually seeded.
        config(['dentaflow.local_clinic_id' => CurrentClinic::id()]);
    }

    private function driveUpdate(array $update): array
    {
        $sent = [];
        Http::fake(function ($request) use (&$sent) {
            if (str_contains($request->url(), '/sendMessage')) {
                $sent[] = $request->data()['text'] ?? '';
            }

            return Http::response(['ok' => true, 'result' => []], 200);
        });

        config(['telegram.bot_token' => 'test-token']);

        $command = app(TelegramPoll::class);
        $telegram = app(TelegramService::class);
        $checkService = app(\App\Services\CheckService::class);

        $method = (new ReflectionClass($command))->getMethod('handleUpdate');
        $method->setAccessible(true);
        $method->invoke($command, $update, $telegram, $checkService);

        return $sent;
    }

    private function linkDoctor(): TelegramLink
    {
        $doctor = $this->makeDoctor();

        return TelegramLink::create([
            'doctor_id' => $doctor->id,
            'telegram_chat_id' => 555000111,
            'linked_at' => now(),
        ]);
    }

    private function messageUpdate(int $chatId, string $text): array
    {
        return [
            'update_id' => random_int(1, 999999),
            'message' => ['chat' => ['id' => $chatId], 'text' => $text],
        ];
    }

    public function test_a_doctor_searching_a_patient_sees_which_teeth_are_done_and_which_are_pending(): void
    {
        $link = $this->linkDoctor();
        $patient = $this->makePatient('سامر خالد');
        $service = $this->makeService('حشوة');

        ToothFinding::create(['patient_id' => $patient->id, 'tooth_number' => 16, 'finding_type' => 'caries', 'status' => 'done', 'service_id' => $service->id, 'recorded_at' => now()]);
        ToothFinding::create(['patient_id' => $patient->id, 'tooth_number' => 26, 'finding_type' => 'caries', 'status' => 'planned', 'service_id' => $service->id, 'recorded_at' => now()]);

        // Search flow: type the name, then tap the returned button.
        $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, '🔍 بحث عن مريض'));
        $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, 'سامر'));
        $sent = $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, 'سامر خالد'));

        $teethMessage = collect($sent)->first(fn ($t) => str_contains($t, 'وضع أسنان'));

        $this->assertNotNull($teethMessage, 'expected a tooth-chart summary message');
        $this->assertStringContainsString('منجز', $teethMessage);
        $this->assertStringContainsString('16', $teethMessage);
        $this->assertStringContainsString('مخطط', $teethMessage);
        $this->assertStringContainsString('26', $teethMessage);
    }

    public function test_a_doctor_searching_a_patient_sees_their_account_balance(): void
    {
        $link = $this->linkDoctor();
        $patient = $this->makePatient('ريم ياسين');

        PatientTransaction::create([
            'patient_id' => $patient->id,
            'type' => 'charge',
            'reference_type' => 'manual',
            'amount' => 250,
            'currency' => 'ILS',
            'exchange_rate' => 1,
            'amount_ils' => 250,
            'occurred_at' => now(),
        ]);

        $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, '🔍 بحث عن مريض'));
        $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, 'ريم'));
        $sent = $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, 'ريم ياسين'));

        $accountMessage = collect($sent)->first(fn ($t) => str_contains($t, 'كشف الحساب'));

        $this->assertNotNull($accountMessage, 'expected an account balance message, got: '.json_encode($sent, JSON_UNESCAPED_UNICODE));
        $this->assertStringContainsString('عليه', $accountMessage);
        $this->assertStringContainsString('250', $accountMessage);
    }

    public function test_a_patient_with_no_balance_reads_as_settled_not_blank(): void
    {
        $link = $this->linkDoctor();
        $patient = $this->makePatient('لينا سامي');

        $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, '🔍 بحث عن مريض'));
        $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, 'لينا'));
        $sent = $this->driveUpdate($this->messageUpdate($link->telegram_chat_id, 'لينا سامي'));

        $accountMessage = collect($sent)->first(fn ($t) => str_contains($t, 'كشف الحساب'));

        $this->assertNotNull($accountMessage);
        $this->assertStringContainsString('لا يوجد رصيد', $accountMessage);
    }
}
