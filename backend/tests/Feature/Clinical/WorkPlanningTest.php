<?php

namespace Tests\Feature\Clinical;

use App\Models\Invoice;
use App\Models\WorkItemToothStep;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * The "تخطيط العمل" tab lets a session be reshaped after the fact — teeth added
 * or dropped, steps repriced, progress ticked and un-ticked, values copied
 * across teeth. Every one of those can touch work that has already been billed,
 * so each has to keep the invoice and the chart honest, not just the checkbox.
 */
class WorkPlanningTest extends TestCase
{
    private function billedSession(array $teeth = [11, 21], float $price = 100): array
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), $teeth));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        return [$patient, $doctor, $workItem->fresh(), Invoice::findOrFail($result['invoice_id'])];
    }

    /**
     * "طبّق نفس القيم على كل الأسنان" copies the source tooth's progress across
     * the session. When the source is un-ticked, that copy clears the other
     * teeth too — and if those were already invoiced, clearing the tick without
     * reversing the charge leaves the tooth reading "not done" while the patient
     * is still billed for it.
     */
    public function test_copying_an_unticked_tooth_across_the_session_gives_the_money_back(): void
    {
        [, , $workItem, $invoice] = $this->billedSession([11, 21], 100);

        $this->assertEquals(200, $invoice->fresh()->total_amount_ils);

        // Un-tick the source tooth — this reverses its own charge properly.
        $source = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->firstOrFail();
        app(WorkItemService::class)->updateToothStep($source, false, null);

        $this->assertEquals(100, $invoice->fresh()->total_amount_ils);

        // Now copy that (un-ticked) state across every tooth in the session.
        app(WorkItemService::class)->applyToAllTeeth($workItem->fresh(), 11);

        $other = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 21)->firstOrFail();

        $this->assertNull($other->completed_at, 'Tooth 21 should follow the source and read as not done.');
        $this->assertNull($other->invoice_line_id, 'A tooth that reads as not done must not still be sitting on an invoice.');
        $this->assertEquals(0, $invoice->fresh()->total_amount_ils, 'Un-doing the work has to hand the money back.');
    }

    /** Ticking a tooth via the copy shortcut is fine — it just becomes billable. */
    public function test_copying_a_ticked_tooth_across_the_session_marks_the_others_done(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->makeWorkItem($patient, $doctor, $this->makeService(price: 100), [11, 21]);

        $source = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->firstOrFail();
        app(WorkItemService::class)->updateToothStep($source, true, null);

        app(WorkItemService::class)->applyToAllTeeth($workItem->fresh(), 11);

        $other = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 21)->firstOrFail();
        $this->assertNotNull($other->completed_at);
    }

    /** Dropping a billed tooth takes its charge off the invoice with it. */
    public function test_removing_a_billed_tooth_reverses_its_charge(): void
    {
        [, , $workItem, $invoice] = $this->billedSession([11, 21], 100);

        app(WorkItemService::class)->removeTooth($workItem, 11);

        $this->assertEquals(100, $invoice->fresh()->total_amount_ils);
        $this->assertSame(0, WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->count());
    }

    /** Correcting a price after billing corrects the invoice, not just future work. */
    public function test_repricing_a_billed_step_corrects_the_invoice(): void
    {
        [, , $workItem, $invoice] = $this->billedSession([11], 100);

        $step = $workItem->steps()->firstOrFail();
        app(WorkItemService::class)->updateStepPrice($step, 150);

        $this->assertEquals(150, $invoice->fresh()->total_amount_ils, 'The correction has to land on the bill the patient already has.');
    }

    /** Dropping the last tooth cancels the session rather than leaving it stranded. */
    public function test_removing_the_last_tooth_cancels_the_session(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->makeWorkItem($patient, $doctor, $this->makeService(), [11]);

        app(WorkItemService::class)->removeTooth($workItem, 11);

        $this->assertSame('cancelled', $workItem->fresh()->status);
    }

    /** Adding a tooth gives it the same steps everything else in the session has. */
    public function test_a_tooth_added_later_gets_the_sessions_steps(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->makeWorkItem($patient, $doctor, $this->makeService(), [11]);

        app(WorkItemService::class)->addTeeth($workItem, [21]);

        $stepCount = $workItem->steps()->count();
        $this->assertSame(
            $stepCount,
            WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 21)->count(),
        );
    }

    /** Adding a tooth already on the session must not duplicate its steps. */
    public function test_adding_a_tooth_twice_does_not_double_it_up(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->makeWorkItem($patient, $doctor, $this->makeService(), [11]);

        app(WorkItemService::class)->addTeeth($workItem, [11]);

        $this->assertSame(1, $workItem->fresh()->teeth()->where('tooth_number', 11)->count());
    }

    /** A tooth number that isn't on the chart has no business on a session. */
    public function test_a_session_cannot_be_opened_on_a_tooth_that_does_not_exist(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $service = $this->makeService();

        $this->actingAs($this->owner)->postJson('/api/work-items', [
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'service_id' => $service->id,
            'tooth_numbers' => [99],
        ])->assertStatus(422)->assertJsonValidationErrors('tooth_numbers.0');
    }

    public function test_a_tooth_that_does_not_exist_cannot_be_added_later(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->makeWorkItem($patient, $doctor, $this->makeService(), [11]);

        $this->actingAs($this->owner)
            ->postJson("/api/work-items/{$workItem->id}/teeth", ['tooth_numbers' => [99]])
            ->assertStatus(422)
            ->assertJsonValidationErrors('tooth_numbers.0');
    }

    /** Cancelling a whole session clears everything it charged. */
    public function test_cancelling_a_session_clears_what_it_charged(): void
    {
        [$patient, , $workItem, $invoice] = $this->billedSession([11, 21], 100);

        app(WorkItemService::class)->cancel($workItem);

        $this->assertSame('cancelled', $workItem->fresh()->status);
        $this->assertEquals(0, $invoice->fresh()->total_amount_ils);
    }
}
