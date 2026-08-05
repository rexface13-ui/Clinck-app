<?php

namespace Tests\Feature\Clinical;

use App\Models\Appointment;
use App\Models\WorkItem;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * The calendar is the one screen the whole clinic looks at, so the rules that
 * keep it honest — no doctor in two chairs at once, no visit deleted out from
 * under work that was already billed — need to hold from the API in, not just
 * in whichever form happens to be on screen.
 */
class AppointmentSchedulingTest extends TestCase
{
    private function book(array $overrides = [])
    {
        return $this->actingAs($this->owner)->postJson('/api/appointments', array_merge([
            'branch_id' => $this->branch->id,
            'patient_id' => $this->makePatient()->id,
            'starts_at' => '2026-09-01 10:00:00',
            'ends_at' => '2026-09-01 10:30:00',
        ], $overrides));
    }

    public function test_a_doctor_cannot_be_booked_into_an_overlapping_slot(): void
    {
        $doctor = $this->makeDoctor();

        $this->book(['doctor_id' => $doctor->id])->assertCreated();

        // Starts inside the first visit and runs past its end.
        $this->book([
            'doctor_id' => $doctor->id,
            'starts_at' => '2026-09-01 10:15:00',
            'ends_at' => '2026-09-01 10:45:00',
        ])->assertStatus(422)->assertJsonValidationErrors('starts_at');
    }

    public function test_a_visit_starting_exactly_when_another_ends_is_allowed(): void
    {
        $doctor = $this->makeDoctor();

        $this->book(['doctor_id' => $doctor->id])->assertCreated();

        // Back-to-back is how a real day is packed — treating the shared
        // boundary as a clash would make the calendar unusable.
        $this->book([
            'doctor_id' => $doctor->id,
            'starts_at' => '2026-09-01 10:30:00',
            'ends_at' => '2026-09-01 11:00:00',
        ])->assertCreated();
    }

    public function test_two_doctors_can_work_the_same_hour(): void
    {
        $this->book(['doctor_id' => $this->makeDoctor('د. أول')->id])->assertCreated();
        $this->book(['doctor_id' => $this->makeDoctor('د. ثاني')->id])->assertCreated();
    }

    /** A cancelled visit is a hole in the day, not a booking. */
    public function test_a_cancelled_visit_frees_its_slot(): void
    {
        $doctor = $this->makeDoctor();

        $first = $this->book(['doctor_id' => $doctor->id])->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->patchJson("/api/appointments/{$first}", ['status' => 'cancelled'])
            ->assertOk();

        $this->book(['doctor_id' => $doctor->id])->assertCreated();
    }

    public function test_rescheduling_onto_a_busy_slot_is_refused(): void
    {
        $doctor = $this->makeDoctor();

        $this->book(['doctor_id' => $doctor->id])->assertCreated();
        $second = $this->book([
            'doctor_id' => $doctor->id,
            'starts_at' => '2026-09-01 12:00:00',
            'ends_at' => '2026-09-01 12:30:00',
        ])->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->patchJson("/api/appointments/{$second}", [
                'starts_at' => '2026-09-01 10:10:00',
                'ends_at' => '2026-09-01 10:40:00',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('starts_at');
    }

    /** Moving a visit must not be blocked by the visit's own current slot. */
    public function test_a_visit_does_not_clash_with_itself(): void
    {
        $doctor = $this->makeDoctor();
        $id = $this->book(['doctor_id' => $doctor->id])->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->patchJson("/api/appointments/{$id}", [
                'starts_at' => '2026-09-01 10:05:00',
                'ends_at' => '2026-09-01 10:35:00',
            ])
            ->assertOk();
    }

    public function test_a_visit_must_end_after_it_starts(): void
    {
        $this->book(['ends_at' => '2026-09-01 09:00:00'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('ends_at');
    }

    /**
     * The charge stays real whether or not the visit row survives, so deleting
     * the visit would leave an invoice with no visible link back to a day.
     */
    public function test_a_visit_with_billed_work_cannot_be_deleted(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $id = $this->book(['patient_id' => $patient->id, 'doctor_id' => $doctor->id])->assertCreated()->json('data.id');

        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: 150), [11]));
        $workItem->update(['appointment_id' => $id]);

        app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        $this->actingAs($this->owner)->deleteJson("/api/appointments/{$id}")->assertStatus(422);
        $this->assertNotNull(Appointment::find($id));
    }

    /** Unbilled work just loses the link — the progress recorded on it stays. */
    public function test_deleting_a_visit_keeps_its_unbilled_work(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $id = $this->book(['patient_id' => $patient->id, 'doctor_id' => $doctor->id])->assertCreated()->json('data.id');

        $workItem = $this->makeWorkItem($patient, $doctor, $this->makeService(), [11]);
        $workItem->update(['appointment_id' => $id]);

        $this->actingAs($this->owner)->deleteJson("/api/appointments/{$id}")->assertNoContent();

        $this->assertNull(Appointment::find($id));
        $this->assertNotNull(WorkItem::find($workItem->id), 'The session itself should survive the visit being deleted.');
        $this->assertNull(WorkItem::find($workItem->id)->appointment_id);
    }

    /**
     * Checking out without naming an appointment (the walk-in path) must not
     * erase the visit a session was already booked under — that quietly cut the
     * work out of the visit's history and let the visit be deleted afterwards.
     */
    public function test_a_walk_in_checkout_does_not_erase_an_existing_visit_link(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();

        // Booked for a future day, so nothing resolves it as "today's visit".
        $id = $this->book([
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'starts_at' => '2026-12-01 10:00:00',
            'ends_at' => '2026-12-01 10:30:00',
        ])->assertCreated()->json('data.id');

        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: 150), [11]));
        $workItem->update(['appointment_id' => $id]);

        app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        $this->assertSame($id, $workItem->fresh()->appointment_id);
    }

    public function test_a_status_change_is_written_to_the_visit_timeline(): void
    {
        $id = $this->book()->assertCreated()->json('data.id');

        $this->actingAs($this->owner)
            ->patchJson("/api/appointments/{$id}", ['status' => 'no_show'])
            ->assertOk();

        $timeline = $this->actingAs($this->owner)->getJson("/api/appointments/{$id}/timeline")->assertOk()->json();

        $this->assertNotEmpty(array_filter($timeline, fn ($row) => $row['action'] === 'appointment.status_changed'));
    }
}
