<?php

namespace Tests\Feature\Billing;

use App\Models\Cashbox;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\PatientRelative;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * Patients can be linked into a relative group ("أب", "زوجة"...), transitive
 * across chains (A-B, B-C means A's group includes C with no direct A-C
 * link), which two things build on: a combined ledger across the whole
 * group, and a single payment that pays off the whole group's debt at once
 * (whoever's standing at the desk first, then whoever owes the most).
 */
class PatientRelativesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);
    }

    private function billedInvoice(Patient $patient, float $price): Invoice
    {
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), [11]));

        $result = app(WorkItemService::class)->checkout(patient: $patient, workItemIds: [$workItem->id], doctorId: $doctor->id);

        return Invoice::findOrFail($result['invoice_id']);
    }

    private function link(Patient $a, Patient $b, string $label = 'قريب'): void
    {
        PatientRelative::create(['patient_id' => $a->id, 'related_patient_id' => $b->id, 'label' => $label]);
    }

    public function test_a_patient_with_no_relatives_has_a_group_of_just_themselves(): void
    {
        $patient = $this->makePatient();

        $this->assertSame([$patient->id], $patient->relativeGroupIds());
    }

    public function test_directly_linked_patients_are_in_each_others_group(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $this->link($a, $b, 'زوجة');

        $this->assertEqualsCanonicalizing([$a->id, $b->id], $a->fresh()->relativeGroupIds());
        $this->assertEqualsCanonicalizing([$a->id, $b->id], $b->fresh()->relativeGroupIds());
    }

    /** The transitive case named in the commit message: A-B and B-C linked, but no direct A-C link. */
    public function test_relatives_chain_transitively_through_an_intermediate_patient(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $c = $this->makePatient('ج');
        $this->link($a, $b);
        $this->link($b, $c);

        $this->assertEqualsCanonicalizing([$a->id, $b->id, $c->id], $a->fresh()->relativeGroupIds());
    }

    /** A link is stored once regardless of which patient's page added it — direct-relatives must read the same from both sides. */
    public function test_direct_relatives_list_reads_the_same_from_either_side_of_the_link(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $this->link($a, $b, 'أب');

        $fromA = $a->fresh()->directRelatives();
        $fromB = $b->fresh()->directRelatives();

        $this->assertCount(1, $fromA);
        $this->assertCount(1, $fromB);
        $this->assertSame($b->id, $fromA->first()['relative']->id);
        $this->assertSame($a->id, $fromB->first()['relative']->id);
        $this->assertSame('أب', $fromA->first()['label']);
    }

    public function test_combined_ledger_merges_transactions_across_the_whole_relative_group(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $this->link($a, $b);

        $this->billedInvoice($a, 300);
        $this->billedInvoice($b, 200);

        $response = $this->getJson("/api/patients/{$a->id}/ledger?combined=1")->assertOk();

        $rows = $response->json('transactions');
        $this->assertCount(2, $rows);
        $this->assertEqualsCanonicalizing([$a->id, $b->id], collect($rows)->pluck('patient_id')->all());
        $this->assertEquals(500.0, $response->json('outstanding_ils'));
    }

    public function test_a_single_patient_ledger_is_unaffected_by_the_combined_flag_with_no_relatives(): void
    {
        $patient = $this->makePatient();
        $this->billedInvoice($patient, 150);

        $plain = $this->getJson("/api/patients/{$patient->id}/ledger")->assertOk();
        $combined = $this->getJson("/api/patients/{$patient->id}/ledger?combined=1")->assertOk();

        $this->assertSame($plain->json('transactions'), $combined->json('transactions'));
    }

    public function test_combined_payment_pays_the_requesting_patient_first(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $this->link($a, $b);
        $this->billedInvoice($a, 100);
        $this->billedInvoice($b, 300);

        // $a owes less but is the one standing at the desk — must be paid
        // first regardless of who owes more, per the documented ordering.
        app(PaymentService::class)->collectCombined($a, $this->cashbox, 100, 'ILS', 1.0, 'cash');

        $this->assertSame(0.0, $this->outstanding($a));
        $this->assertSame(300.0, $this->outstanding($b));
    }

    public function test_combined_payment_spills_onto_whoever_owes_most_after_the_requesting_patient_is_settled(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $c = $this->makePatient('ج');
        $this->link($a, $b);
        $this->link($a, $c);
        $this->billedInvoice($a, 100);
        $this->billedInvoice($b, 500);
        $this->billedInvoice($c, 200);

        // Covers a's own 100, then b (owes more than c) gets whatever's left.
        app(PaymentService::class)->collectCombined($a, $this->cashbox, 250, 'ILS', 1.0, 'cash');

        $this->assertSame(0.0, $this->outstanding($a));
        $this->assertSame(350.0, $this->outstanding($b));
        $this->assertSame(200.0, $this->outstanding($c));
    }

    public function test_combined_payment_surplus_past_every_debt_lands_as_credit_on_the_last_patient(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $this->link($a, $b);
        $this->billedInvoice($a, 100);
        $this->billedInvoice($b, 100);

        app(PaymentService::class)->collectCombined($a, $this->cashbox, 300, 'ILS', 1.0, 'cash');

        $this->assertSame(0.0, $this->outstanding($a));
        $this->assertSame(-100.0, $this->outstanding($b), 'the 100 surplus should land as a credit on the last patient paid');
    }

    public function test_combined_payment_settles_the_linked_patients_invoice_status_too(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $this->link($a, $b);
        $this->billedInvoice($a, 100);
        $bInvoice = $this->billedInvoice($b, 200);

        app(PaymentService::class)->collectCombined($a, $this->cashbox, 300, 'ILS', 1.0, 'cash');

        $this->assertSame('paid', $bInvoice->fresh()->status);
    }

    /**
     * The bug fixed alongside this feature: deleting an unallocated payment
     * (no invoice_id — which is exactly what every collectCombined() leg
     * creates) never recomputed invoice statuses, so an invoice it had
     * settled stayed stuck reading "paid" forever after the payment that
     * settled it was removed.
     */
    public function test_deleting_an_unallocated_payment_reopens_the_invoices_it_had_settled(): void
    {
        $patient = $this->makePatient();
        $invoice = $this->billedInvoice($patient, 300);

        $payment = app(PaymentService::class)->collect($patient, $this->cashbox, 300, 'ILS', 1.0, 'cash');

        $this->assertSame('paid', $invoice->fresh()->status);

        app(PaymentService::class)->deletePayment($payment);

        $this->assertSame('unpaid', $invoice->fresh()->status);
        $this->assertSame(300.0, $this->outstanding($patient));
    }

    private function outstanding(Patient $patient): float
    {
        $running = 0.0;
        foreach (\App\Models\PatientTransaction::where('patient_id', $patient->id)->get(['type', 'amount_ils']) as $t) {
            $running += in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils;
        }

        return round($running, 2);
    }
}
