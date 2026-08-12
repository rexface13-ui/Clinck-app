<?php

namespace Tests\Feature\Billing;

use App\Models\Invoice;
use App\Services\CheckService;
use Illuminate\Support\Facades\DB;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * The four cards on top of a patient's account: what the work came to, what has
 * actually been collected, what was taken off as discount, and what is left.
 *
 * They have to agree with the rows listed underneath them — a card that tells a
 * different story from the table is worse than no card, because the card is
 * what gets read out loud to the patient.
 */
class LedgerSummaryTest extends TestCase
{
    private function bill($patient, float $price = 100, array $teeth = [11]): Invoice
    {
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), $teeth));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        return Invoice::findOrFail($result['invoice_id']);
    }

    private function totals($patient): array
    {
        return $this->actingAs($this->owner)
            ->getJson("/api/patients/{$patient->id}/ledger")
            ->assertOk()
            ->json('totals');
    }

    public function test_the_four_cards_add_up_on_a_plain_account(): void
    {
        $patient = $this->makePatient();
        $this->bill($patient, 200);

        app(PaymentService::class)->collect(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 120,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
            invoice: null,
        );

        $totals = $this->totals($patient);

        $this->assertEquals(200, $totals['charged_ils']);
        $this->assertEquals(120, $totals['collected_ils']);
        $this->assertEquals(0, $totals['discounted_ils']);
        $this->assertEquals(80, $totals['outstanding_ils']);
    }

    /** A general discount lowers what is owed without touching what was billed. */
    public function test_a_general_discount_shows_as_discount_not_as_less_billed(): void
    {
        $patient = $this->makePatient();
        $this->bill($patient, 200);

        $this->actingAs($this->owner)
            ->postJson("/api/patients/{$patient->id}/discount", ['amount' => 50, 'note' => 'خصم عام'])
            ->assertCreated();

        $totals = $this->totals($patient);

        $this->assertEquals(200, $totals['charged_ils'], 'The work still cost 200 — the discount is a separate figure.');
        $this->assertEquals(50, $totals['discounted_ils']);
        $this->assertEquals(150, $totals['outstanding_ils']);
    }

    /** Money taken by check counts as collected the same as cash. */
    public function test_a_check_counts_as_collected(): void
    {
        $patient = $this->makePatient();
        $this->bill($patient, 300);

        app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '771',
            bankName: 'بنك',
            amount: 300,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
        );

        $totals = $this->totals($patient);

        $this->assertEquals(300, $totals['collected_ils']);
        $this->assertEquals(0, $totals['outstanding_ils']);
    }

    /**
     * A bounced check puts the debt back. That is not a new bill for treatment,
     * so it must not inflate the invoices card — only what is owed.
     */
    public function test_a_bounced_check_raises_what_is_owed_without_inflating_the_invoices_card(): void
    {
        $patient = $this->makePatient();
        $this->bill($patient, 300);

        $check = app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '772',
            bankName: 'بنك',
            amount: 300,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
        );

        app(CheckService::class)->bounce($check);

        $totals = $this->totals($patient);

        $this->assertEquals(300, $totals['charged_ils'], 'A bounced check is not treatment that was billed.');
        $this->assertEquals(300, $totals['outstanding_ils']);
    }

    /** Undoing billed work reads as a discount off the account, not a payment. */
    public function test_reversed_work_lands_in_the_discounts_card(): void
    {
        $patient = $this->makePatient();
        $invoice = $this->bill($patient, 100, [11, 21]);

        $this->assertEquals(200, $this->totals($patient)['charged_ils']);

        $toothStep = \App\Models\WorkItemToothStep::whereHas(
            'workItem',
            fn ($q) => $q->where('patient_id', $patient->id)
        )->where('tooth_number', 11)->firstOrFail();

        app(WorkItemService::class)->updateToothStep($toothStep, false, null);

        $totals = $this->totals($patient);

        $this->assertEquals(200, $totals['charged_ils'], 'What was originally billed does not get rewritten.');
        $this->assertEquals(100, $totals['discounted_ils']);
        $this->assertEquals(100, $totals['outstanding_ils']);
    }

    /** A refund gives money back, so it lowers what has been collected. */
    public function test_a_refund_lowers_what_was_collected(): void
    {
        $patient = $this->makePatient();
        $this->bill($patient, 200);

        app(PaymentService::class)->collect(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 200,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
            invoice: null,
        );

        app(PaymentService::class)->refund(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 50,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
        );

        $totals = $this->totals($patient);

        $this->assertEquals(150, $totals['collected_ils']);
        $this->assertEquals(50, $totals['outstanding_ils']);
    }

    /** The invariant tying all four together. */
    public function test_billed_minus_discounts_minus_collected_is_what_is_left(): void
    {
        $patient = $this->makePatient();
        $this->bill($patient, 240);
        $this->bill($patient, 800);

        app(PaymentService::class)->collect(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 344,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
            invoice: null,
        );

        $this->actingAs($this->owner)
            ->postJson("/api/patients/{$patient->id}/discount", ['amount' => 56])
            ->assertCreated();

        $t = $this->totals($patient);

        $this->assertEquals(
            round($t['charged_ils'] - $t['discounted_ils'] - $t['collected_ils'], 2),
            $t['outstanding_ils'],
            'The four cards have to reconcile with each other on screen.',
        );
    }

    /** The outstanding card must not drift from the running balance below it. */
    public function test_the_outstanding_card_matches_the_last_row_of_the_table(): void
    {
        $patient = $this->makePatient();
        $this->bill($patient, 500);

        app(PaymentService::class)->collect(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 175,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
            invoice: null,
        );

        $ledger = $this->actingAs($this->owner)
            ->getJson("/api/patients/{$patient->id}/ledger")->assertOk()->json();

        // Rows come back newest-first, so the newest row carries the balance.
        $this->assertEquals(
            $ledger['transactions'][0]['balance_after_ils'],
            $ledger['totals']['outstanding_ils'],
        );
    }

    /**
     * The upgrade path: settled_amount_ils is a column that didn't exist
     * before, and `paid_ils` reads straight off it. If adding the column
     * doesn't also fill it, every invoice in the clinic shows "مدفوعة" next to
     * "المدفوع 0.00 ₪" from the moment the update finishes — so the backfill
     * is part of the schema change, not something to run later.
     */
    public function test_a_freshly_added_settled_column_gets_filled_in(): void
    {
        $patient = $this->makePatient();
        $invoice = $this->bill($patient, 300);

        app(PaymentService::class)->collect(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 300,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
            invoice: null,
        );

        $this->assertEquals(300, $invoice->fresh()->settled_amount_ils);

        // Exactly what an existing clinic's database looks like the instant the
        // column is created: present, defaulted to 0, never written to.
        DB::table('invoices')->update(['settled_amount_ils' => 0]);

        (require base_path('database/migrations/2026_08_04_110000_add_settled_amount_to_invoices_table.php'))
            ->backfill();

        $invoice = $invoice->fresh();

        $this->assertEquals(300, $invoice->settled_amount_ils, 'A paid invoice must not read as unpaid after the upgrade.');
        $this->assertSame('paid', $invoice->status, 'The backfill fills the new column; it does not rewrite status.');

        $paid = $this->actingAs($this->owner)
            ->getJson("/api/invoices/{$invoice->id}")->assertOk()->json('data.paid_ils');

        $this->assertEquals(300, $paid);
    }

    public function test_an_account_with_nothing_on_it_reports_zeroes(): void
    {
        $totals = $this->totals($this->makePatient());

        foreach (['charged_ils', 'collected_ils', 'discounted_ils', 'outstanding_ils'] as $key) {
            $this->assertEquals(0, $totals[$key], "{$key} should start at zero.");
        }
    }
}
