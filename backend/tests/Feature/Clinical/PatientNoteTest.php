<?php

namespace Tests\Feature\Clinical;

use App\Models\Note;
use App\Models\WorkItemToothStep;
use Tests\TestCase;

/**
 * Notes are where the clinical judgement lives — why a tooth was left, what the
 * patient said, what to watch next visit. A note filed against the wrong
 * patient, tooth or session is worse than no note, because it will be trusted.
 */
class PatientNoteTest extends TestCase
{
    private function addNote(int $patientId, array $payload = [])
    {
        return $this->actingAs($this->owner)->postJson("/api/patients/{$patientId}/notes", array_merge([
            'body' => 'المريض بشتكي من حساسية على البارد',
        ], $payload));
    }

    public function test_a_general_note_is_saved_against_the_patient(): void
    {
        $patient = $this->makePatient();

        $id = $this->addNote($patient->id)->assertCreated()->json('data.id');

        $note = Note::findOrFail($id);
        $this->assertSame($patient->getMorphClass(), $note->notable_type);
        $this->assertSame($patient->id, $note->notable_id);
        $this->assertSame($this->owner->id, $note->user_id);
    }

    public function test_an_empty_note_is_refused(): void
    {
        $patient = $this->makePatient();

        $this->addNote($patient->id, ['body' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors('body');
    }

    public function test_a_note_cannot_be_filed_against_a_tooth_that_does_not_exist(): void
    {
        $patient = $this->makePatient();

        $this->addNote($patient->id, ['tooth_number' => 99])
            ->assertStatus(422)
            ->assertJsonValidationErrors('tooth_number');
    }

    public function test_a_note_can_be_tied_to_a_tooth(): void
    {
        $patient = $this->makePatient();

        $id = $this->addNote($patient->id, ['tooth_number' => 26])->assertCreated()->json('data.id');

        $this->assertSame(26, (int) Note::findOrFail($id)->tooth_number);
    }

    /** Tagging a note with someone else's session would leak it across files. */
    public function test_a_note_cannot_be_tied_to_another_patients_session(): void
    {
        $mine = $this->makePatient('صاحب الملف');
        $other = $this->makePatient('مريض ثاني');
        $doctor = $this->makeDoctor();

        $theirWork = $this->makeWorkItem($other, $doctor, $this->makeService(), [11]);

        $this->addNote($mine->id, ['work_item_id' => $theirWork->id])->assertStatus(422);
    }

    /** A step-scoped note has to be on the tooth it claims to be about. */
    public function test_a_step_note_must_match_the_tooth_it_is_filed_under(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->makeWorkItem($patient, $doctor, $this->makeService(), [11, 21]);

        $stepOnEleven = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->firstOrFail();

        $this->addNote($patient->id, [
            'work_item_tooth_step_id' => $stepOnEleven->id,
            'tooth_number' => 21,
        ])->assertStatus(422);
    }

    public function test_a_step_note_infers_its_session(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->makeWorkItem($patient, $doctor, $this->makeService(), [11]);

        $step = WorkItemToothStep::where('work_item_id', $workItem->id)->firstOrFail();

        $id = $this->addNote($patient->id, [
            'work_item_tooth_step_id' => $step->id,
            'tooth_number' => 11,
        ])->assertCreated()->json('data.id');

        $this->assertSame($workItem->id, Note::findOrFail($id)->work_item_id);
    }

    public function test_a_note_can_be_corrected_and_flagged_important(): void
    {
        $patient = $this->makePatient();
        $id = $this->addNote($patient->id)->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->patchJson("/api/patients/{$patient->id}/notes/{$id}", ['body' => 'تصحيح', 'is_important' => true])
            ->assertOk();

        $note = Note::findOrFail($id);
        $this->assertSame('تصحيح', $note->body);
        $this->assertTrue((bool) $note->is_important);
    }

    public function test_a_note_cannot_be_edited_through_another_patients_file(): void
    {
        $mine = $this->makePatient('صاحب الملف');
        $other = $this->makePatient('مريض ثاني');

        $id = $this->addNote($mine->id)->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->patchJson("/api/patients/{$other->id}/notes/{$id}", ['body' => 'اختراق'])
            ->assertNotFound();

        $this->actingAs($this->owner)
            ->deleteJson("/api/patients/{$other->id}/notes/{$id}")
            ->assertNotFound();

        $this->assertNotNull(Note::find($id));
    }

    public function test_a_note_can_be_deleted_from_its_own_file(): void
    {
        $patient = $this->makePatient();
        $id = $this->addNote($patient->id)->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->deleteJson("/api/patients/{$patient->id}/notes/{$id}")
            ->assertNoContent();

        $this->assertNull(Note::find($id));
    }
}
