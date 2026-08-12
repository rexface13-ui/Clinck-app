<?php

namespace Tests\Feature\Clinical;

use App\Models\DoctorTransaction;
use Tests\TestCase;

/**
 * The chart is never stored as a picture — it is rebuilt every time from the
 * findings recorded against each tooth. That makes the findings the patient's
 * actual clinical record, and anything derived from them (which teeth are
 * missing, what the chart looked like on a past date, what the doctor earned)
 * has to follow them exactly.
 */
class ToothChartTest extends TestCase
{
    private function addFinding(int $patientId, array $payload = [])
    {
        return $this->actingAs($this->owner)->postJson("/api/patients/{$patientId}/chart/findings", array_merge([
            'tooth_number' => 11,
            'finding_type' => 'تسوس',
            'status' => 'planned',
        ], $payload));
    }

    public function test_a_finding_marked_missing_makes_the_tooth_missing_on_the_chart(): void
    {
        $patient = $this->makePatient();

        $this->addFinding($patient->id, ['tooth_number' => 26, 'finding_type' => 'قلع', 'status' => 'done', 'marks_missing' => true])
            ->assertCreated();

        $states = $this->actingAs($this->owner)->getJson("/api/patients/{$patient->id}/chart")->assertOk()->json('tooth_states');

        $missing = collect($states)->firstWhere('tooth_number', 26);
        $this->assertSame('missing', $missing['status']);
    }

    /** Deleting the finding that marked a tooth gone has to put the tooth back. */
    public function test_deleting_the_finding_that_marked_a_tooth_missing_restores_it(): void
    {
        $patient = $this->makePatient();

        $id = $this->addFinding($patient->id, ['tooth_number' => 26, 'finding_type' => 'قلع', 'status' => 'done', 'marks_missing' => true])
            ->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->deleteJson("/api/patients/{$patient->id}/chart/findings/{$id}")
            ->assertNoContent();

        $states = $this->actingAs($this->owner)->getJson("/api/patients/{$patient->id}/chart")->assertOk()->json('tooth_states');

        $this->assertSame('present', collect($states)->firstWhere('tooth_number', 26)['status']);
    }

    /**
     * Two findings can mark the same tooth missing (an extraction recorded
     * twice, or an extraction plus a later note). Removing one of them must
     * not resurrect a tooth the other one still says is gone.
     */
    public function test_a_tooth_stays_missing_while_another_finding_still_says_so(): void
    {
        $patient = $this->makePatient();

        $first = $this->addFinding($patient->id, ['tooth_number' => 26, 'finding_type' => 'قلع', 'status' => 'done', 'marks_missing' => true])
            ->assertCreated()->json('data.id');
        $this->addFinding($patient->id, ['tooth_number' => 26, 'finding_type' => 'مفقود', 'status' => 'done', 'marks_missing' => true])
            ->assertCreated();

        $this->actingAs($this->owner)->deleteJson("/api/patients/{$patient->id}/chart/findings/{$first}")->assertNoContent();

        $states = $this->actingAs($this->owner)->getJson("/api/patients/{$patient->id}/chart")->assertOk()->json('tooth_states');
        $this->assertSame('missing', collect($states)->firstWhere('tooth_number', 26)['status']);
    }

    /** "شو كان وضعه وقتها" — the chart has to be rebuildable for a past date. */
    public function test_the_chart_as_of_a_past_date_ignores_later_findings(): void
    {
        $patient = $this->makePatient();

        $this->addFinding($patient->id, ['tooth_number' => 11, 'finding_type' => 'حشوة', 'status' => 'done', 'recorded_at' => '2026-01-10 09:00:00'])->assertCreated();
        $this->addFinding($patient->id, ['tooth_number' => 21, 'finding_type' => 'تسوس', 'status' => 'planned', 'recorded_at' => '2026-06-10 09:00:00'])->assertCreated();

        $findings = $this->actingAs($this->owner)
            ->getJson("/api/patients/{$patient->id}/chart?as_of=2026-03-01")
            ->assertOk()->json('tooth_findings');

        $this->assertCount(1, $findings, 'A finding recorded after the cutoff must not appear in a historical chart.');
        $this->assertSame(11, $findings[0]['tooth_number']);
    }

    public function test_a_tooth_number_outside_the_fdi_chart_is_refused(): void
    {
        $patient = $this->makePatient();

        $this->addFinding($patient->id, ['tooth_number' => 99])
            ->assertStatus(422)
            ->assertJsonValidationErrors('tooth_number');
    }

    public function test_a_finding_cannot_be_edited_through_another_patients_file(): void
    {
        $mine = $this->makePatient('صاحب الملف');
        $other = $this->makePatient('مريض ثاني');

        $id = $this->addFinding($mine->id)->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->patchJson("/api/patients/{$other->id}/chart/findings/{$id}", ['status' => 'done'])
            ->assertNotFound();
    }

    /** Marking a procedure done is what earns the doctor their cut. */
    public function test_marking_a_finding_done_posts_the_doctors_commission(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor(commissionPercent: 20);
        $service = $this->makeService(price: 500);

        $id = $this->addFinding($patient->id, [
            'finding_type' => 'تاج',
            'status' => 'planned',
            'service_id' => $service->id,
            'doctor_id' => $doctor->id,
        ])->assertCreated()->json('data.id');

        $this->assertSame(0, DoctorTransaction::where('doctor_id', $doctor->id)->count(), 'A planned procedure has not been done yet.');

        $this->actingAs($this->owner)
            ->patchJson("/api/patients/{$patient->id}/chart/findings/{$id}", ['status' => 'done'])
            ->assertOk();

        $this->assertEquals(100, DoctorTransaction::where('doctor_id', $doctor->id)->where('type', 'commission')->sum('amount_ils'));
    }

    /** Saving "done" twice must not pay the doctor twice for one procedure. */
    public function test_re_saving_a_done_finding_does_not_pay_the_commission_again(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor(commissionPercent: 20);
        $service = $this->makeService(price: 500);

        $id = $this->addFinding($patient->id, [
            'finding_type' => 'تاج',
            'status' => 'done',
            'service_id' => $service->id,
            'doctor_id' => $doctor->id,
        ])->assertCreated()->json('data.id');

        foreach (range(1, 3) as $ignored) {
            $this->actingAs($this->owner)
                ->patchJson("/api/patients/{$patient->id}/chart/findings/{$id}", ['status' => 'done'])
                ->assertOk();
        }

        $this->assertSame(1, DoctorTransaction::where('doctor_id', $doctor->id)->where('type', 'commission')->count());
        $this->assertEquals(100, DoctorTransaction::where('doctor_id', $doctor->id)->sum('amount_ils'));
    }

    /** No service or no doctor means there is nothing to base a commission on. */
    public function test_a_done_finding_with_no_doctor_earns_nothing(): void
    {
        $patient = $this->makePatient();
        $service = $this->makeService(price: 500);

        $this->addFinding($patient->id, ['status' => 'done', 'service_id' => $service->id])->assertCreated();

        $this->assertSame(0, DoctorTransaction::where('type', 'commission')->count());
    }
}
