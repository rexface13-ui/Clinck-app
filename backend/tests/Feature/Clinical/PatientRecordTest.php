<?php

namespace Tests\Feature\Clinical;

use App\Models\Allergy;
use App\Models\Patient;
use App\Models\Supplier;
use Tests\TestCase;

/**
 * Prescriptions, lab cases and the allergy catalogue are the paper trail around
 * a visit. None of it moves money, but a prescription filed under the wrong
 * patient or an allergy quietly deleted out of a file is the kind of mistake
 * nobody notices until it matters.
 */
class PatientRecordTest extends TestCase
{
    public function test_a_prescription_is_filed_against_the_patient_it_was_written_for(): void
    {
        $patient = $this->makePatient('صاحب الوصفة');
        $other = $this->makePatient('مريض ثاني');
        $doctor = $this->makeDoctor();

        $this->actingAs($this->owner)->postJson('/api/prescriptions', [
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'medications' => 'أموكسيسيلين 500 مغ',
        ])->assertCreated();

        $this->assertCount(1, $this->actingAs($this->owner)
            ->getJson("/api/prescriptions?patient_id={$patient->id}")->assertOk()->json('data'));

        $this->assertCount(0, $this->actingAs($this->owner)
            ->getJson("/api/prescriptions?patient_id={$other->id}")->assertOk()->json('data'),
            "Another patient's file must not show this prescription.");
    }

    public function test_a_prescription_with_no_medications_is_refused(): void
    {
        $patient = $this->makePatient();

        $this->actingAs($this->owner)->postJson('/api/prescriptions', [
            'patient_id' => $patient->id,
            'medications' => '',
        ])->assertStatus(422)->assertJsonValidationErrors('medications');
    }

    public function test_the_newest_prescription_is_listed_first(): void
    {
        $patient = $this->makePatient();

        foreach (['قديمة', 'أحدث'] as $text) {
            $this->actingAs($this->owner)->postJson('/api/prescriptions', [
                'patient_id' => $patient->id,
                'medications' => $text,
            ])->assertCreated();

            $this->travel(1)->minutes();
        }

        $list = $this->actingAs($this->owner)->getJson("/api/prescriptions?patient_id={$patient->id}")->assertOk()->json('data');

        $this->assertSame('أحدث', $list[0]['medications']);
    }

    private function sendLabCase(int $patientId, array $overrides = [])
    {
        $supplier = Supplier::create(['name' => 'مخبر الأسنان', 'is_active' => true]);

        return $this->actingAs($this->owner)->postJson('/api/lab-cases', array_merge([
            'patient_id' => $patientId,
            'supplier_id' => $supplier->id,
            'description' => 'تاج زيركون',
            'tooth_numbers' => [16],
            'sent_at' => '2026-08-01',
            'expected_return_date' => '2026-08-10',
        ], $overrides));
    }

    public function test_a_lab_case_starts_as_sent_and_is_not_yet_back(): void
    {
        $case = $this->sendLabCase($this->makePatient()->id)->assertCreated()->json('data');

        $this->assertSame('sent', $case['status']);
        $this->assertNull($case['received_at'] ?? null);
    }

    /** The date the work came back is the clinic's record, not a typed field. */
    public function test_receiving_a_lab_case_stamps_the_date_it_came_back(): void
    {
        $id = $this->sendLabCase($this->makePatient()->id)->assertCreated()->json('data.id');

        $received = $this->actingAs($this->owner)
            ->putJson("/api/lab-cases/{$id}", ['status' => 'received'])
            ->assertOk()->json('data');

        $this->assertSame('received', $received['status']);
        $this->assertNotNull($received['received_at']);
    }

    /** Correcting a note on a case already back must not re-stamp its date. */
    public function test_editing_a_received_case_keeps_its_original_return_date(): void
    {
        $id = $this->sendLabCase($this->makePatient()->id)->assertCreated()->json('data.id');

        $first = $this->actingAs($this->owner)
            ->putJson("/api/lab-cases/{$id}", ['status' => 'received'])->assertOk()->json('data.received_at');

        $this->travel(2)->days();

        $second = $this->actingAs($this->owner)
            ->putJson("/api/lab-cases/{$id}", ['status' => 'received', 'notes' => 'تعديل'])->assertOk()->json('data.received_at');

        $this->assertSame($first, $second);
    }

    public function test_lab_cases_can_be_filtered_to_one_patient(): void
    {
        $mine = $this->makePatient('صاحب الحالة');
        $this->sendLabCase($mine->id)->assertCreated();
        $this->sendLabCase($this->makePatient('مريض ثاني')->id)->assertCreated();

        $list = $this->actingAs($this->owner)->getJson("/api/lab-cases?patient_id={$mine->id}")->assertOk()->json('data');

        $this->assertCount(1, $list);
    }

    public function test_an_unknown_status_is_refused_on_a_lab_case(): void
    {
        $id = $this->sendLabCase($this->makePatient()->id)->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->putJson("/api/lab-cases/{$id}", ['status' => 'lost'])
            ->assertStatus(422);
    }

    /**
     * Patients hold allergies by name, not by foreign key, so deleting the
     * catalogue entry would leave the warning in the file pointing at nothing.
     */
    public function test_an_allergy_in_use_by_a_patient_cannot_be_deleted(): void
    {
        $allergy = Allergy::create(['name' => 'بنسلين']);

        $patient = $this->makePatient();
        $patient->update(['medical_alerts' => ['بنسلين']]);

        $this->actingAs($this->owner)->deleteJson("/api/allergies/{$allergy->id}")->assertStatus(422);

        $this->assertNotNull(Allergy::find($allergy->id));
    }

    public function test_an_unused_allergy_can_be_deleted(): void
    {
        $allergy = Allergy::create(['name' => 'لاتكس']);

        $this->actingAs($this->owner)->deleteJson("/api/allergies/{$allergy->id}")->assertNoContent();

        $this->assertNull(Allergy::find($allergy->id));
    }

    /** Typing an allergy that already exists shouldn't blow up the patient form. */
    public function test_adding_an_allergy_that_already_exists_is_a_quiet_no_op(): void
    {
        Allergy::create(['name' => 'بنسلين']);

        $this->actingAs($this->owner)->postJson('/api/allergies', ['name' => 'بنسلين'])->assertSuccessful();

        $this->assertSame(1, Allergy::where('name', 'بنسلين')->count());
    }

    /** Two patients must never end up sharing a file number. */
    public function test_every_patient_gets_its_own_file_number(): void
    {
        $codes = collect(range(1, 5))->map(fn () => $this->makePatient()->code);

        $this->assertSame($codes->count(), $codes->unique()->count());
    }

    /** Deleting an old file must not hand its number to the next patient. */
    public function test_a_new_file_number_never_collides_with_one_in_use(): void
    {
        $first = $this->makePatient('أول');
        $second = $this->makePatient('ثاني');

        Patient::where('id', $first->id)->delete();

        $next = $this->makePatient('ثالث');

        $this->assertNotSame($second->code, $next->code);
    }
}
