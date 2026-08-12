<?php

namespace Tests\Feature\Billing;

use App\Models\CheckModel;
use App\Models\Invoice;
use App\Models\PatientTransaction;
use App\Services\CheckService;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * Covers a patient paying by check.
 *
 * The bug this exists for: a check settled the patient's balance but was never
 * tied to an invoice, so invoices the patient had genuinely paid kept reading
 * "غير مدفوعة" forever, and every report built on the payments table missed
 * the money entirely.
 */
class CheckSettlementTest extends TestCase
{
    private function billedInvoice(float $price = 300): array
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), [11]));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        return [$patient, Invoice::findOrFail($result['invoice_id'])];
    }

    private function receiveCheck($patient, float $amount, ?int $invoiceId = null): CheckModel
    {
        return app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '12345',
            bankName: 'بنك تجريبي',
            amount: $amount,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
            invoiceId: $invoiceId,
        );
    }

    public function test_a_check_applied_to_an_invoice_marks_it_paid(): void
    {
        [$patient, $invoice] = $this->billedInvoice(300);

        $this->assertSame('unpaid', $invoice->status);

        $this->receiveCheck($patient, 300, $invoice->id);

        // The regression: this used to stay 'unpaid' no matter what.
        $this->assertSame('paid', $invoice->fresh()->status);
    }

    public function test_a_check_smaller_than_the_invoice_leaves_it_partial(): void
    {
        [$patient, $invoice] = $this->billedInvoice(300);

        $this->receiveCheck($patient, 100, $invoice->id);

        $this->assertSame('partial', $invoice->fresh()->status);
    }

    public function test_a_check_settles_the_patients_balance(): void
    {
        [$patient, $invoice] = $this->billedInvoice(300);

        $this->receiveCheck($patient, 300, $invoice->id);

        $this->assertSame(0.0, $this->balanceOf($patient));
    }

    public function test_a_bounced_check_puts_the_invoice_back_to_owing(): void
    {
        [$patient, $invoice] = $this->billedInvoice(300);
        $check = $this->receiveCheck($patient, 300, $invoice->id);

        $this->assertSame('paid', $invoice->fresh()->status);

        app(CheckService::class)->bounce($check);

        $this->assertSame('bounced', $check->fresh()->status);
        $this->assertSame('unpaid', $invoice->fresh()->status, 'A bounced check must stop settling the invoice.');
        $this->assertSame(300.0, $this->balanceOf($patient), 'A bounced check must put the debt back on the patient.');
    }

    /** A check taken without naming an invoice still settles the overall balance. */
    public function test_a_check_with_no_invoice_still_credits_the_patient(): void
    {
        [$patient] = $this->billedInvoice(300);

        $this->receiveCheck($patient, 300);

        $this->assertSame(0.0, $this->balanceOf($patient));
    }

    public function test_a_check_cannot_be_applied_to_another_patients_invoice(): void
    {
        [, $invoice] = $this->billedInvoice(300);
        $someoneElse = $this->makePatient('مريض تاني');

        $this->expectExceptionMessage('الفاتورة لا تخص هذا المريض.');

        $this->receiveCheck($someoneElse, 300, $invoice->id);
    }

    private function balanceOf($patient): float
    {
        return round((float) PatientTransaction::where('patient_id', $patient->id)
            ->get()
            ->sum(fn ($t) => in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils), 2);
    }
}
