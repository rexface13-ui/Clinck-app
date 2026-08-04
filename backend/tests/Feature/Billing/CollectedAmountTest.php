<?php

namespace Tests\Feature\Billing;

use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * Guards the "المبلغ المحصّل" field on the edit-session form.
 *
 * The bug this exists for: checkout() collected the payment but never wrote
 * work_items.collected_amount_ils, so the form showed 0 for a session the
 * patient had already paid in full. Correcting it to the true figure was read
 * as a brand new collection and charged the patient a second time.
 */
class CollectedAmountTest extends TestCase
{
    private function checkoutPaidInFull(float $price = 200): array
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $service = $this->makeService(price: $price);
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $service, [11]));

        app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
            payCashboxId: $this->cashbox->id,
            payMethod: 'cash',
            payAmount: $price,
        );

        return [$patient->fresh(), $workItem->fresh()];
    }

    public function test_a_paid_session_reports_what_was_actually_collected(): void
    {
        [, $workItem] = $this->checkoutPaidInFull(200);

        // The regression itself: this used to be 0.00 for a fully-paid session.
        $this->assertSame(200.0, $workItem->actualCollectedIls());
    }

    public function test_re_saving_the_same_collected_amount_does_not_charge_again(): void
    {
        [$patient, $workItem] = $this->checkoutPaidInFull(200);

        $balanceBefore = $this->balanceOf($patient);
        $cashboxBefore = (float) $this->cashbox->fresh()->balance;
        $paymentsBefore = Payment::where('patient_id', $patient->id)->count();

        // The exact action that used to double-charge: opening the session and
        // saving the figure the form already displays.
        app(WorkItemService::class)->updateCollectedAmount(
            workItem: $workItem,
            newAmount: $workItem->actualCollectedIls(),
            cashboxId: $this->cashbox->id,
            method: 'cash',
        );

        $this->assertSame($balanceBefore, $this->balanceOf($patient->fresh()), 'Re-saving the displayed amount changed the patient balance.');
        $this->assertSame($cashboxBefore, (float) $this->cashbox->fresh()->balance, 'Re-saving the displayed amount moved money in the cashbox.');
        $this->assertSame($paymentsBefore, Payment::where('patient_id', $patient->id)->count(), 'Re-saving the displayed amount created another payment.');
    }

    public function test_raising_the_collected_amount_collects_only_the_difference(): void
    {
        [$patient, $workItem] = $this->checkoutPaidInFull(200);

        $cashboxBefore = (float) $this->cashbox->fresh()->balance;

        app(WorkItemService::class)->updateCollectedAmount(
            workItem: $workItem,
            newAmount: 250,
            cashboxId: $this->cashbox->id,
            method: 'cash',
        );

        $this->assertSame(
            round($cashboxBefore + 50, 2),
            round((float) $this->cashbox->fresh()->balance, 2),
            'Raising 200 to 250 should take 50, not 250.',
        );
        $this->assertSame(250.0, $workItem->fresh()->actualCollectedIls());
    }

    public function test_lowering_the_collected_amount_refunds_the_difference(): void
    {
        [$patient, $workItem] = $this->checkoutPaidInFull(200);

        $cashboxBefore = (float) $this->cashbox->fresh()->balance;

        app(WorkItemService::class)->updateCollectedAmount(
            workItem: $workItem,
            newAmount: 120,
            cashboxId: $this->cashbox->id,
            method: 'cash',
        );

        $this->assertSame(
            round($cashboxBefore - 80, 2),
            round((float) $this->cashbox->fresh()->balance, 2),
            'Lowering 200 to 120 should give back 80.',
        );
    }

    /**
     * When one checkout bills two sessions onto a single invoice, each
     * session must report its own share of the payment — not the whole thing,
     * which would make correcting either one double-charge again.
     */
    public function test_two_sessions_on_one_invoice_split_the_payment_between_them(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();

        $cheap = $this->makeService('حشوة', 100);
        $pricey = $this->makeService('تاج', 300);

        $a = $this->completeWork($this->makeWorkItem($patient, $doctor, $cheap, [11]));
        $b = $this->completeWork($this->makeWorkItem($patient, $doctor, $pricey, [21]));

        app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$a->id, $b->id],
            doctorId: $doctor->id,
            payCashboxId: $this->cashbox->id,
            payMethod: 'cash',
            payAmount: 400,
        );

        $this->assertSame(100.0, $a->fresh()->actualCollectedIls());
        $this->assertSame(300.0, $b->fresh()->actualCollectedIls());
    }

    /** A partial payment is shared out in proportion, and still adds up. */
    public function test_a_partial_payment_is_shared_in_proportion(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();

        $a = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('حشوة', 100), [11]));
        $b = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('تاج', 300), [21]));

        app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$a->id, $b->id],
            doctorId: $doctor->id,
            payCashboxId: $this->cashbox->id,
            payMethod: 'cash',
            payAmount: 200,
        );

        $this->assertSame(50.0, $a->fresh()->actualCollectedIls());
        $this->assertSame(150.0, $b->fresh()->actualCollectedIls());
        $this->assertSame(200.0, $a->fresh()->actualCollectedIls() + $b->fresh()->actualCollectedIls());
    }

    public function test_an_unpaid_session_reports_nothing_collected(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: 200), [11]));

        app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        $this->assertSame(0.0, $workItem->fresh()->actualCollectedIls());
    }

    private function balanceOf($patient): float
    {
        return round((float) PatientTransaction::where('patient_id', $patient->id)
            ->get()
            ->sum(fn ($t) => in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils), 2);
    }
}
