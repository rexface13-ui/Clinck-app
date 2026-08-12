<?php

namespace Tests\Feature\Billing;

use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\WorkItemToothStep;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use Tests\TestCase;

/** Discounting, deleting and re-numbering invoices. */
class InvoiceLifecycleTest extends TestCase
{
    private function billedInvoice(float $price = 400): array
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), [11]));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        return [$patient, Invoice::findOrFail($result['invoice_id']), $workItem->fresh()];
    }

    public function test_a_discount_lowers_the_total_and_the_patients_debt(): void
    {
        [$patient, $invoice] = $this->billedInvoice(400);

        app(PaymentService::class)->adjustTotal($invoice, 300);

        $this->assertSame('300.00', $invoice->fresh()->total_amount_ils);
        $this->assertSame(300.0, $this->balanceOf($patient), 'The discount must come off what the patient owes.');
    }

    /** Lines keep their list price — the discount lives as its own ledger row. */
    public function test_a_discount_does_not_rewrite_the_original_charge_lines(): void
    {
        [, $invoice] = $this->billedInvoice(400);

        app(PaymentService::class)->adjustTotal($invoice, 300);

        $this->assertSame(400.0, (float) $invoice->lines()->sum('amount_ils'));
        $this->assertSame(-100.0, (float) PatientTransaction::where('reference_type', 'invoice_discount')->sum('amount_ils'));
    }

    public function test_discounting_an_invoice_to_zero_reads_as_settled(): void
    {
        [, $invoice] = $this->billedInvoice(400);

        app(PaymentService::class)->adjustTotal($invoice, 0);
        app(PaymentService::class)->refreshInvoiceStatus($invoice->fresh());

        // Used to sit at 'unpaid' forever with nothing left to pay.
        $this->assertSame('paid', $invoice->fresh()->status);
    }

    public function test_deleting_an_invoice_removes_it_and_every_ledger_row_it_created(): void
    {
        [$patient, $invoice] = $this->billedInvoice(400);
        app(PaymentService::class)->adjustTotal($invoice, 300);

        app(PaymentService::class)->deleteInvoice($invoice->fresh());

        $this->assertNull(Invoice::find($invoice->id));
        $this->assertSame(0, InvoiceLine::where('invoice_id', $invoice->id)->count());
        $this->assertSame(0.0, $this->balanceOf($patient), 'Deleting an invoice must leave no charge and no leftover discount behind.');
    }

    public function test_deleting_an_invoice_puts_its_work_back_to_not_yet_billed(): void
    {
        [, $invoice, $workItem] = $this->billedInvoice(400);

        $this->assertNotNull(WorkItemToothStep::where('work_item_id', $workItem->id)->first()->invoice_line_id);

        app(PaymentService::class)->deleteInvoice($invoice);

        $toothStep = WorkItemToothStep::where('work_item_id', $workItem->id)->first();
        $this->assertNull($toothStep->invoice_line_id, 'The work must become billable again.');
        $this->assertNull($toothStep->completed_at);
    }

    public function test_an_invoice_with_a_payment_on_it_cannot_be_deleted(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: 400), [11]));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
            payCashboxId: $this->cashbox->id,
            payMethod: 'cash',
            payAmount: 400,
        );

        $this->expectExceptionMessage('في دفعات مسجّلة عالفاتورة هاي');

        app(PaymentService::class)->deleteInvoice(Invoice::findOrFail($result['invoice_id']));
    }

    /**
     * Both sequences were generated with count()+1. Deleting any record that
     * wasn't the newest dropped the count below the highest number in use, so
     * the next one handed back a code that already belonged to someone —
     * "P-000009 already exists" on save. The invariant that matters is simply
     * that the next number is never one already taken.
     */
    public function test_a_new_patient_code_never_collides_with_an_existing_one(): void
    {
        $first = $this->makePatient('أول');
        $this->makePatient('تاني');
        $this->makePatient('تالت');

        // Delete an older patient, not the newest — this is what used to make
        // the count fall out of step with the highest code issued.
        $first->delete();

        $next = Patient::nextCode();

        $this->assertSame(0, Patient::where('code', $next)->count(), "nextCode() handed back {$next}, which is already in use.");
        $this->assertNotNull($this->makePatient('رابع')->code);
    }

    public function test_a_new_invoice_number_never_collides_with_an_existing_one(): void
    {
        [, $first] = $this->billedInvoice(100);
        [, $second] = $this->billedInvoice(100);

        app(PaymentService::class)->deleteInvoice($first);

        [, $third] = $this->billedInvoice(100);

        $this->assertNotSame($second->invoice_number, $third->invoice_number, 'A new invoice reused a number still on the books.');
        $this->assertSame(1, Invoice::where('invoice_number', $third->invoice_number)->count());
    }

    private function balanceOf($patient): float
    {
        return round((float) PatientTransaction::where('patient_id', $patient->id)
            ->get()
            ->sum(fn ($t) => in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils), 2);
    }
}
