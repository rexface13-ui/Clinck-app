<?php

namespace Tests\Feature\Clinical;

use App\Console\Commands\TelegramNotifyAttachment;
use App\Models\Attachment;
use App\Models\TelegramLink;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * X-rays and consent forms live in the patient's file for years, so the two
 * things that matter are that a batch arrives whole and that each file can be
 * given a name a human will recognise later.
 */
class PatientAttachmentTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        // The detached notifier command pins tenancy to local_clinic_id (it
        // runs outside a request) — point it at the clinic this test actually
        // seeded, same fix as CheckImageNotificationTest.
        config(['dentaflow.local_clinic_id' => \App\Support\Tenancy\CurrentClinic::id()]);
    }

    public function test_several_files_upload_in_one_go(): void
    {
        $patient = $this->makePatient();

        $response = $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'files' => [
                UploadedFile::fake()->image('xray-1.jpg'),
                UploadedFile::fake()->image('xray-2.jpg'),
                UploadedFile::fake()->image('xray-3.jpg'),
            ],
        ])->assertCreated();

        $this->assertCount(3, $response->json('data'));
        $this->assertSame(3, Attachment::where('attachable_id', $patient->id)->count());
    }

    /** Each file in a batch can carry its own label. */
    public function test_a_batch_keeps_each_files_own_title(): void
    {
        $patient = $this->makePatient();

        $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'files' => [
                UploadedFile::fake()->image('a.jpg'),
                UploadedFile::fake()->image('b.jpg'),
            ],
            'titles' => ['أشعة قبل', 'أشعة بعد'],
        ])->assertCreated();

        $titles = Attachment::where('attachable_id', $patient->id)->pluck('title')->all();

        $this->assertEqualsCanonicalizing(['أشعة قبل', 'أشعة بعد'], $titles);
    }

    /** The old single-file form still has to work. */
    public function test_a_single_file_still_uploads(): void
    {
        $patient = $this->makePatient();

        $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->image('one.jpg'),
        ])->assertCreated();

        $this->assertSame(1, Attachment::where('attachable_id', $patient->id)->count());
    }

    public function test_uploading_nothing_is_refused(): void
    {
        $patient = $this->makePatient();

        $this->actingAs($this->owner)
            ->postJson("/api/patients/{$patient->id}/attachments", [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('file');
    }

    public function test_a_title_can_be_rewritten_later(): void
    {
        $patient = $this->makePatient();

        $id = $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->image('IMG_5512.jpg'),
        ])->assertCreated()->json('data.0.id');

        $updated = $this->actingAs($this->owner)
            ->patchJson("/api/patients/{$patient->id}/attachments/{$id}", ['title' => 'أشعة بانوراما 2026'])
            ->assertOk()->json('data');

        $this->assertSame('أشعة بانوراما 2026', $updated['title']);
        $this->assertSame('أشعة بانوراما 2026', $updated['display_name']);
        $this->assertSame('IMG_5512.jpg', $updated['original_name'], 'Renaming is a label, not a rename of the stored file.');
    }

    /** Clearing the title falls back to the file name rather than showing blank. */
    public function test_clearing_the_title_falls_back_to_the_file_name(): void
    {
        $patient = $this->makePatient();

        $id = $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->image('scan.jpg'),
            'title' => 'مؤقت',
        ])->assertCreated()->json('data.0.id');

        $updated = $this->actingAs($this->owner)
            ->patchJson("/api/patients/{$patient->id}/attachments/{$id}", ['title' => ''])
            ->assertOk()->json('data');

        $this->assertNull($updated['title']);
        $this->assertSame('scan.jpg', $updated['display_name']);
    }

    public function test_an_attachment_cannot_be_renamed_through_another_patients_file(): void
    {
        $mine = $this->makePatient('صاحب الملف');
        $other = $this->makePatient('مريض ثاني');

        $id = $this->actingAs($this->owner)->postJson("/api/patients/{$mine->id}/attachments", [
            'file' => UploadedFile::fake()->image('private.jpg'),
        ])->assertCreated()->json('data.0.id');

        $this->actingAs($this->owner)
            ->patchJson("/api/patients/{$other->id}/attachments/{$id}", ['title' => 'اختراق'])
            ->assertNotFound();
    }

    public function test_deleting_an_attachment_removes_the_stored_file_too(): void
    {
        $patient = $this->makePatient();

        $id = $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->image('gone.jpg'),
        ])->assertCreated()->json('data.0.id');

        $path = Attachment::findOrFail($id)->path;
        Storage::disk('local')->assertExists($path);

        $this->actingAs($this->owner)
            ->deleteJson("/api/patients/{$patient->id}/attachments/{$id}")
            ->assertNoContent();

        Storage::disk('local')->assertMissing($path);
        $this->assertNull(Attachment::find($id));
    }

    public function test_asking_for_photos_without_a_linked_telegram_account_says_so(): void
    {
        $patient = $this->makePatient();

        $this->actingAs($this->owner)
            ->postJson("/api/patients/{$patient->id}/attachments/request-telegram", ['count' => 3])
            ->assertStatus(422);
    }

    public function test_the_number_of_photos_requested_is_bounded(): void
    {
        $patient = $this->makePatient();

        foreach ([0, 99] as $count) {
            $this->actingAs($this->owner)
                ->postJson("/api/patients/{$patient->id}/attachments/request-telegram", ['count' => $count])
                ->assertStatus(422)
                ->assertJsonValidationErrors('count');
        }
    }

    /**
     * Picking a doctor while uploading has to actually launch the push
     * notifier — same detached-process contract as a check's own photo, so
     * an unreachable Telegram can never slow down the upload response.
     */
    public function test_uploading_with_a_chosen_doctor_launches_the_notifier(): void
    {
        Process::fake();
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();

        $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->image('xray.jpg'),
            'notify_doctor_id' => $doctor->id,
        ])->assertCreated();

        Process::assertRan(fn ($process) => in_array('telegram:notify-attachment', $process->command, true));
    }

    /** Uploading without picking anyone must not launch it at all — the push is opt-in per upload. */
    public function test_uploading_without_a_doctor_launches_nothing(): void
    {
        Process::fake();
        $patient = $this->makePatient();

        $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->image('xray.jpg'),
        ])->assertCreated();

        Process::assertDidntRun(fn ($process) => in_array('telegram:notify-attachment', $process->command, true));
    }

    /** The detached command is what actually reaches Telegram — an image attachment goes through as a photo. */
    public function test_the_detached_command_sends_an_image_attachment_as_a_photo_to_the_chosen_doctor(): void
    {
        config(['telegram.bot_token' => 'test-token']);
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        TelegramLink::create(['doctor_id' => $doctor->id, 'telegram_chat_id' => 123123123, 'linked_at' => now()]);

        $id = $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->image('xray.jpg'),
        ])->assertCreated()->json('data.0.id');

        $sent = [];
        Http::fake(function ($request) use (&$sent) {
            $sent[] = $request->url();

            return Http::response(['ok' => true], 200);
        });

        Artisan::call(TelegramNotifyAttachment::class, ['attachmentId' => $id, 'doctorId' => $doctor->id]);

        $this->assertNotEmpty($sent);
        $this->assertStringContainsString('sendPhoto', $sent[0]);
    }

    /** A non-image attachment (a PDF report, say) can't render as a photo — it goes through as a document instead. */
    public function test_the_detached_command_sends_a_non_image_attachment_as_a_document(): void
    {
        config(['telegram.bot_token' => 'test-token']);
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        TelegramLink::create(['doctor_id' => $doctor->id, 'telegram_chat_id' => 123123124, 'linked_at' => now()]);

        $id = $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->create('report.pdf', 10, 'application/pdf'),
        ])->assertCreated()->json('data.0.id');

        $sent = [];
        Http::fake(function ($request) use (&$sent) {
            $sent[] = $request->url();

            return Http::response(['ok' => true], 200);
        });

        Artisan::call(TelegramNotifyAttachment::class, ['attachmentId' => $id, 'doctorId' => $doctor->id]);

        $this->assertNotEmpty($sent);
        $this->assertStringContainsString('sendDocument', $sent[0]);
    }

    /** No linked chat for that doctor — the command must just do nothing, not error out. */
    public function test_the_detached_command_is_a_no_op_when_the_doctor_has_no_linked_telegram(): void
    {
        config(['telegram.bot_token' => 'test-token']);
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();

        $id = $this->actingAs($this->owner)->postJson("/api/patients/{$patient->id}/attachments", [
            'file' => UploadedFile::fake()->image('xray.jpg'),
        ])->assertCreated()->json('data.0.id');

        Http::fake();

        Artisan::call(TelegramNotifyAttachment::class, ['attachmentId' => $id, 'doctorId' => $doctor->id]);

        Http::assertNothingSent();
    }
}
