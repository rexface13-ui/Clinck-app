<?php

namespace Tests\Feature\Clinical;

use App\Models\Attachment;
use Illuminate\Http\UploadedFile;
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
}
