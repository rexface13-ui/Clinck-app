<?php

namespace Tests\Feature\Billing;

use App\Models\Invoice;
use App\Services\CheckService;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * Invoice status has to follow the money across a patient's whole account, not
 * just what happens to be tagged to one invoice.
 *
 * The bug: a check covering four visits could only ever be tagged to one of
 * them, so a patient who owed nothing still had invoices reading
 * "غير مدفوعة". Cash taken without picking an invoice had the same blind spot.
 */
class InvoiceAllocationTest extends TestCase
{
    private function billInvoice($patient, float $price): Invoice
    {
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), [11]));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        return Invoice::findOrFail($result['invoice_id']);
    }

    public function test_a_lump_sum_with_no_invoice_picked_settles_the_oldest_bills_first(): void
    {
        $patient = $this->makePatient();
        $first = $this->billInvoice($patient, 100);
        $second = $this->billInvoice($patient, 200);

        // "بدون ربط بفاتورة معيّنة" — exactly what the collection form allows.
        app(PaymentService::class)->collect(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 150,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
            invoice: null,
        );

        $this->assertSame('paid', $first->fresh()->status, 'The oldest bill should be settled first.');
        $this->assertSame('partial', $second->fresh()->status);
    }

    public function test_one_check_can_settle_several_invoices(): void
    {
        $patient = $this->makePatient();
        $a = $this->billInvoice($patient, 100);
        $b = $this->billInvoice($patient, 200);
        $c = $this->billInvoice($patient, 300);

        app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '555',
            bankName: 'بنك',
            amount: 600,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
        );

        // The regression: all three used to stay "unpaid" because one check
        // can only carry one invoice_id.
        foreach ([$a, $b, $c] as $invoice) {
            $this->assertSame('paid', $invoice->fresh()->status, "{$invoice->invoice_number} should be settled by the check.");
        }
    }

    public function test_money_tagged_to_an_invoice_stays_on_that_invoice(): void
    {
        $patient = $this->makePatient();
        $older = $this->billInvoice($patient, 100);
        $newer = $this->billInvoice($patient, 100);

        // Paid specifically against the newer bill, skipping the older one.
        app(PaymentService::class)->collect(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 100,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
            invoice: $newer,
        );

        $this->assertSame('unpaid', $older->fresh()->status, 'A payment made against a named invoice must not be re-pointed at an older one.');
        $this->assertSame('paid', $newer->fresh()->status);
    }

    public function test_overpaying_one_invoice_goes_towards_the_others(): void
    {
        $patient = $this->makePatient();
        $first = $this->billInvoice($patient, 100);
        $second = $this->billInvoice($patient, 100);

        app(PaymentService::class)->collect(
            patient: $patient,
            cashbox: $this->cashbox,
            amount: 180,
            currency: 'ILS',
            exchangeRate: 1,
            method: 'cash',
            invoice: $first,
        );

        $this->assertSame('paid', $first->fresh()->status);
        $this->assertSame('partial', $second->fresh()->status, 'The 80 over the first bill should count towards the second.');
    }

    public function test_a_bounced_check_un_settles_every_invoice_it_was_covering(): void
    {
        $patient = $this->makePatient();
        $a = $this->billInvoice($patient, 100);
        $b = $this->billInvoice($patient, 200);

        $check = app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '556',
            bankName: 'بنك',
            amount: 300,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
        );

        $this->assertSame('paid', $a->fresh()->status);

        app(CheckService::class)->bounce($check);

        $this->assertSame('unpaid', $a->fresh()->status);
        $this->assertSame('unpaid', $b->fresh()->status);
    }

    /**
     * "المتبقي" and the paid badge come from the same stored figure, so an
     * invoice can never show "paid" and "متبقي 160 ₪" at once.
     */
    public function test_the_settled_amount_always_agrees_with_the_status(): void
    {
        $patient = $this->makePatient();
        $a = $this->billInvoice($patient, 100);
        $b = $this->billInvoice($patient, 200);

        app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '558',
            bankName: 'بنك',
            amount: 150,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
        );

        $a = $a->fresh();
        $b = $b->fresh();

        $this->assertSame('paid', $a->status);
        $this->assertSame(100.0, (float) $a->settled_amount_ils);

        $this->assertSame('partial', $b->status);
        $this->assertSame(50.0, (float) $b->settled_amount_ils);

        foreach (Invoice::where('patient_id', $patient->id)->get() as $invoice) {
            $total = (float) $invoice->total_amount_ils;
            $settled = (float) $invoice->settled_amount_ils;

            $expected = match (true) {
                $total <= 0 => 'paid',
                $settled <= 0.001 => 'unpaid',
                $settled + 0.01 < $total => 'partial',
                default => 'paid',
            };

            $this->assertSame($expected, $invoice->status, "{$invoice->invoice_number} shows {$invoice->status} but has {$settled} of {$total} settled.");
        }
    }

    /**
     * A discount on the account as a whole never touched any invoice, so the
     * invoices between them claimed more owing than the patient's balance did.
     */
    public function test_a_general_discount_settles_bills_like_cash(): void
    {
        $patient = $this->makePatient();
        $invoice = $this->billInvoice($patient, 200);

        $this->actingAs($this->owner)
            ->postJson("/api/patients/{$patient->id}/discount", ['amount' => 200, 'note' => 'خصم عام'])
            ->assertCreated();

        app(PaymentService::class)->refreshPatientInvoiceStatuses($patient);

        $this->assertSame('paid', $invoice->fresh()->status);
    }

    /** What the invoices say is owing has to equal what the account says is owing. */
    public function test_invoice_remainders_add_up_to_the_patients_balance(): void
    {
        $patient = $this->makePatient();
        $this->billInvoice($patient, 240);
        $this->billInvoice($patient, 800);

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

        app(PaymentService::class)->refreshPatientInvoiceStatuses($patient);

        $balance = round((float) $patient->transactions()->get()
            ->sum(fn ($t) => in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils), 2);

        $remaining = round((float) Invoice::where('patient_id', $patient->id)
            ->get()
            ->sum(fn ($i) => (float) $i->total_amount_ils - (float) $i->settled_amount_ils), 2);

        $this->assertSame($balance, $remaining, "The account says {$balance} owing but the invoices add up to {$remaining}.");
    }

    /** A patient who owes nothing must not have a single invoice reading as owing. */
    public function test_a_settled_patient_has_no_invoice_left_reading_unpaid(): void
    {
        $patient = $this->makePatient();
        $this->billInvoice($patient, 160);
        $this->billInvoice($patient, 100);
        $this->billInvoice($patient, 250);

        app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '557',
            bankName: 'بنك',
            amount: 510,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
        );

        $this->assertSame(0, Invoice::where('patient_id', $patient->id)->whereIn('status', ['unpaid', 'partial'])->count());
    }
}
