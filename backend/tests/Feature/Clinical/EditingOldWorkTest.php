<?php

namespace Tests\Feature\Clinical;

use App\Models\DoctorTransaction;
use App\Models\Invoice;
use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Models\ToothFinding;
use App\Models\WorkItemToothStep;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * Correcting work recorded weeks ago is routine — the wrong tooth was ticked,
 * the price was wrong, the patient changed their mind. What matters is that one
 * correction moves every number that depended on it, not just the obvious one:
 * the invoice total, the invoice's paid/unpaid state, the patient's balance,
 * the session's own status, the dental chart, and the doctor's commission.
 *
 * A correction that fixes the bill but leaves the chart, the balance or the
 * commission behind is worse than no correction, because each of those is read
 * by someone who trusts it.
 */
class EditingOldWorkTest extends TestCase
{
    /** What the patient's account says they still owe. */
    private function balanceOf(int $patientId): float
    {
        return round((float) PatientTransaction::where('patient_id', $patientId)->get()
            ->sum(fn ($t) => in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils), 2);
    }

    private function commissionOf(int $doctorId): float
    {
        return round((float) DoctorTransaction::where('doctor_id', $doctorId)->where('type', 'commission')->sum('amount_ils'), 2);
    }

    /** An old, fully-paid, two-tooth session — the normal thing to go back and fix. */
    private function oldPaidSession(float $price = 100, bool $pricePerTooth = true): array
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor(commissionPercent: 20);
        $service = $this->makeService(price: $price, pricePerTooth: $pricePerTooth);
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $service, [11, 21]));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
            payCashboxId: $this->cashbox->id,
            payMethod: 'cash',
            payAmount: $price * 2,
        );

        $this->travel(3)->weeks();

        return [$patient, $doctor, $workItem->fresh(), Invoice::findOrFail($result['invoice_id'])];
    }

    /**
     * The headline case: un-tick one tooth of an old paid session and every
     * downstream figure has to move with it, in one go.
     */
    public function test_unticking_one_tooth_moves_every_number_that_depended_on_it(): void
    {
        [$patient, $doctor, $workItem, $invoice] = $this->oldPaidSession(100);

        $this->assertEquals(200, $invoice->total_amount_ils);
        $this->assertSame('paid', $invoice->status);
        $this->assertSame(0.0, $this->balanceOf($patient->id));
        $this->assertSame('done', $workItem->status);
        $this->assertSame(40.0, $this->commissionOf($doctor->id), 'Two teeth at 100, 20% each.');

        $toothStep = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->firstOrFail();
        app(WorkItemService::class)->updateToothStep($toothStep, false, null);

        $invoice = $invoice->fresh();

        // The bill.
        $this->assertEquals(100, $invoice->total_amount_ils, 'The invoice should shed the reversed tooth.');

        // The bill's state — the patient paid 200 for what is now a 100 bill.
        $this->assertSame('paid', $invoice->status);

        // The account: 100 charged, 200 paid, so the clinic owes 100 back.
        $this->assertSame(-100.0, $this->balanceOf($patient->id), 'Overpayment has to show as credit on the account.');

        // The session itself is no longer finished.
        $this->assertSame('in_progress', $workItem->fresh()->status);

        // The chart must not still claim that tooth was treated.
        $this->assertSame(
            0,
            ToothFinding::where('patient_id', $patient->id)->where('tooth_number', 11)->where('status', 'done')->count(),
            'A tooth whose work was reversed must not read as done on the chart.',
        );

        // And the doctor must not stay owed for work that was undone.
        $this->assertSame(20.0, $this->commissionOf($doctor->id), 'Commission should drop to the one tooth that stands.');
    }

    /** Re-ticking it puts everything back — corrections have to be reversible. */
    public function test_re_ticking_and_re_billing_restores_every_number(): void
    {
        [$patient, $doctor, $workItem, $invoice] = $this->oldPaidSession(100);

        $toothStep = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->firstOrFail();
        app(WorkItemService::class)->updateToothStep($toothStep, false, null);
        app(WorkItemService::class)->updateToothStep($toothStep->fresh(), true, null);

        app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        $this->assertSame(0.0, $this->balanceOf($patient->id), 'Undoing and redoing the same work must land back at zero.');
        $this->assertSame('done', $workItem->fresh()->status);
        $this->assertSame(40.0, $this->commissionOf($doctor->id));
    }

    /** Repricing old work corrects the bill, the account and the commission. */
    public function test_repricing_an_old_session_flows_through_to_the_account(): void
    {
        [$patient, , $workItem, $invoice] = $this->oldPaidSession(100);

        app(WorkItemService::class)->updateStepPrice($workItem->steps()->firstOrFail(), 120);

        // Two teeth, each up 20.
        $this->assertEquals(240, $invoice->fresh()->total_amount_ils);
        $this->assertSame('partial', $invoice->fresh()->status, 'The patient paid 200 of what is now 240.');
        $this->assertSame(40.0, $this->balanceOf($patient->id), 'The extra 40 has to appear as owing.');
    }

    /** Dropping a tooth from old work is the same story from another entry point. */
    public function test_removing_a_tooth_from_an_old_session_flows_through(): void
    {
        [$patient, $doctor, $workItem, $invoice] = $this->oldPaidSession(100);

        app(WorkItemService::class)->removeTooth($workItem, 11);

        $this->assertEquals(100, $invoice->fresh()->total_amount_ils);
        $this->assertSame(-100.0, $this->balanceOf($patient->id));
        $this->assertSame(20.0, $this->commissionOf($doctor->id));
        $this->assertSame(0, WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->count());
    }

    /** Cancelling an old session zeroes the bill and credits back everything paid. */
    public function test_cancelling_an_old_session_leaves_the_account_owing_nothing(): void
    {
        [$patient, $doctor, $workItem, $invoice] = $this->oldPaidSession(100);

        app(WorkItemService::class)->cancel($workItem);

        $this->assertEquals(0, $invoice->fresh()->total_amount_ils);
        $this->assertSame('cancelled', $workItem->fresh()->status);
        $this->assertSame(-200.0, $this->balanceOf($patient->id), 'Everything paid becomes credit once nothing is owed.');
        $this->assertSame(0.0, $this->commissionOf($doctor->id), 'No work stands, so no commission does.');
    }

    /** Refunding the credit an edit created has to bring the account back to zero. */
    public function test_refunding_the_credit_an_edit_created_squares_the_account(): void
    {
        [$patient, , $workItem] = $this->oldPaidSession(100);

        $toothStep = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->firstOrFail();
        app(WorkItemService::class)->updateToothStep($toothStep, false, null);

        $this->assertSame(-100.0, $this->balanceOf($patient->id));

        app(PaymentService::class)->refund(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 100,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
        );

        $this->assertSame(0.0, $this->balanceOf($patient->id), 'Handing the credit back should settle the account.');
    }

    /**
     * A flat-fee step's single invoice line covers every tooth on it, so one
     * tooth cannot be reversed in isolation — the system has to say so plainly
     * rather than silently losing or double-counting the charge.
     */
    public function test_a_flat_fee_tooth_cannot_be_reversed_alone_and_says_why(): void
    {
        [$patient, , $workItem, $invoice] = $this->oldPaidSession(100, pricePerTooth: false);

        $before = (float) $invoice->total_amount_ils;
        $balanceBefore = $this->balanceOf($patient->id);

        $toothStep = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 11)->firstOrFail();

        try {
            app(WorkItemService::class)->updateToothStep($toothStep, false, null);
            $this->fail('Reversing one tooth of a flat-fee step should be refused.');
        } catch (\Throwable $e) {
            $this->assertStringContainsString('سعرها إجمالي', $e->getMessage());
        }

        $this->assertEquals($before, (float) $invoice->fresh()->total_amount_ils, 'A refused edit must not move the bill.');
        $this->assertSame($balanceBefore, $this->balanceOf($patient->id), 'A refused edit must not move the account.');
        $this->assertNotNull($toothStep->fresh()->completed_at, 'A refused edit must leave the tick as it was.');
    }

    /** Two corrections in a row must not compound into a wrong figure. */
    public function test_two_corrections_in_a_row_stay_consistent(): void
    {
        [$patient, $doctor, $workItem, $invoice] = $this->oldPaidSession(100);

        app(WorkItemService::class)->updateStepPrice($workItem->steps()->firstOrFail(), 150);
        $this->assertEquals(300, $invoice->fresh()->total_amount_ils);

        $toothStep = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 21)->firstOrFail();
        app(WorkItemService::class)->updateToothStep($toothStep, false, null);

        $this->assertEquals(150, $invoice->fresh()->total_amount_ils, 'One tooth left, at the corrected price.');
        $this->assertSame(-50.0, $this->balanceOf($patient->id), '150 owed against 200 paid — a credit of 50.');
        $this->assertSame(20.0, $this->commissionOf($doctor->id));
    }

    /**
     * The invariant behind all of it: whatever the edits, what the invoices say
     * is outstanding always equals what the account says.
     */
    public function test_the_invoices_and_the_account_never_disagree_after_edits(): void
    {
        [$patient, , $workItem] = $this->oldPaidSession(100);

        app(WorkItemService::class)->updateStepPrice($workItem->steps()->firstOrFail(), 130);
        app(WorkItemService::class)->removeTooth($workItem->fresh(), 11);

        app(PaymentService::class)->refreshPatientInvoiceStatuses($patient);

        $charged = round((float) Invoice::where('patient_id', $patient->id)->sum('total_amount_ils'), 2);
        $paid = round((float) Payment::where('patient_id', $patient->id)->sum('amount_ils'), 2);

        $this->assertSame(
            round($charged - $paid, 2),
            $this->balanceOf($patient->id),
            'The invoices and the account have to tell the same story after any edit.',
        );
    }
}
