<?php

namespace Tests\Feature\Billing;

use App\Models\DoctorTransaction;
use App\Models\Invoice;
use App\Models\PatientTransaction;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use Tests\TestCase;

/** Cancelling work that has already been billed, and what it must undo. */
class WorkCancellationTest extends TestCase
{
    private function billedWork(float $price = 500, array $teeth = [11])
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor(commissionPercent: 20);
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), $teeth));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        return [$patient, $doctor, $workItem->fresh(), Invoice::findOrFail($result['invoice_id'])];
    }

    public function test_cancelling_billed_work_takes_the_charge_back_off_the_patient(): void
    {
        [$patient, , $workItem] = $this->billedWork(500);

        $this->assertSame(500.0, $this->balanceOf($patient));

        app(WorkItemService::class)->cancel($workItem);

        $this->assertSame(0.0, $this->balanceOf($patient));
        $this->assertSame('cancelled', $workItem->fresh()->status);
    }

    /**
     * The reversal used to subtract the line's full list price even when a
     * discount had already shrunk the invoice, pushing the total negative.
     */
    public function test_cancelling_discounted_work_never_drives_the_invoice_negative(): void
    {
        [, , $workItem, $invoice] = $this->billedWork(500);

        app(PaymentService::class)->adjustTotal($invoice, 200);

        app(WorkItemService::class)->cancel($workItem);

        $this->assertGreaterThanOrEqual(0, (float) $invoice->fresh()->total_amount_ils, 'An invoice total must never go below zero.');
        $this->assertSame(0.0, (float) $invoice->fresh()->total_amount_ils);
    }

    public function test_cancelling_work_reverses_the_doctors_commission(): void
    {
        [, $doctor, $workItem] = $this->billedWork(500);

        $earned = (float) DoctorTransaction::where('doctor_id', $doctor->id)->where('type', 'commission')->sum('amount_ils');
        $this->assertGreaterThan(0, $earned, 'The doctor should have earned a commission on the billed work.');

        app(WorkItemService::class)->cancel($workItem);

        // The regression: the finding was deleted but the commission stayed,
        // leaving the doctor owed for treatment that never happened.
        $this->assertSame(
            0.0,
            round((float) DoctorTransaction::where('doctor_id', $doctor->id)->where('type', 'commission')->sum('amount_ils'), 2),
            'Cancelled work must not leave the doctor owed a commission.',
        );
    }

    public function test_the_commission_reversal_records_why_it_happened(): void
    {
        [, $doctor, $workItem] = $this->billedWork(500);

        app(WorkItemService::class)->cancel($workItem);

        $reversal = DoctorTransaction::where('doctor_id', $doctor->id)
            ->where('amount_ils', '<', 0)
            ->first();

        $this->assertNotNull($reversal, 'A reversal entry should exist rather than the original silently vanishing.');
        $this->assertStringContainsString('عكس عمولة', (string) $reversal->notes);
    }

    public function test_removing_the_last_tooth_cancels_the_whole_session(): void
    {
        [, , $workItem] = $this->billedWork(500, [11]);

        app(WorkItemService::class)->removeTooth($workItem, 11);

        $this->assertSame('cancelled', $workItem->fresh()->status);
    }

    private function balanceOf($patient): float
    {
        return round((float) PatientTransaction::where('patient_id', $patient->id)
            ->get()
            ->sum(fn ($t) => in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils), 2);
    }
}
