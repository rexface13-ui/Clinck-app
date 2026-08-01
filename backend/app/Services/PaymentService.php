<?php

namespace App\Services;

use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Payment;
use Illuminate\Support\Facades\DB;

class PaymentService
{
    /**
     * A payment always touches three ledgers in one transaction: the
     * payment record itself, the cashbox it landed in (its own currency,
     * with a running balance_after), and the patient's unified ILS ledger.
     */
    public function collect(
        Patient $patient,
        Cashbox $cashbox,
        float $amount,
        string $currency,
        float $exchangeRate,
        string $method,
        ?Invoice $invoice = null,
    ): Payment {
        abort_if($cashbox->currency !== $currency, 422, 'عملة الدفعة لازم تطابق عملة الصندوق.');
        abort_if($invoice && $invoice->patient_id !== $patient->id, 422, 'الفاتورة لا تخص هذا المريض.');

        return DB::transaction(function () use ($patient, $cashbox, $amount, $currency, $exchangeRate, $method, $invoice) {
            $amountIls = round($amount * $exchangeRate, 2);

            $payment = Payment::create([
                'clinic_id' => $patient->clinic_id,
                'patient_id' => $patient->id,
                'invoice_id' => $invoice?->id,
                'cashbox_id' => $cashbox->id,
                'amount' => $amount,
                'currency' => $currency,
                'exchange_rate' => $exchangeRate,
                'amount_ils' => $amountIls,
                'method' => $method,
                'paid_at' => now(),
            ]);

            $newBalance = $cashbox->balance + $amount;
            CashboxTransaction::create([
                'clinic_id' => $patient->clinic_id,
                'cashbox_id' => $cashbox->id,
                'type' => 'payment_in',
                'reference_type' => 'payment',
                'reference_id' => $payment->id,
                'amount' => $amount,
                'balance_after' => $newBalance,
                'occurred_at' => now(),
            ]);
            $cashbox->update(['balance' => $newBalance]);

            PatientTransaction::create([
                'clinic_id' => $patient->clinic_id,
                'patient_id' => $patient->id,
                'type' => 'payment',
                'reference_type' => 'payment',
                'reference_id' => $payment->id,
                'amount' => $amount,
                'currency' => $currency,
                'exchange_rate' => $exchangeRate,
                'amount_ils' => $amountIls,
                'occurred_at' => now(),
            ]);

            if ($invoice) {
                $this->refreshInvoiceStatus($invoice);
            }

            return $payment->fresh(['cashbox', 'invoice']);
        });
    }

    /**
     * Corrects an already-issued invoice's total after the fact — e.g. a
     * discount agreed with the patient after checkout. Posts the signed
     * difference as an 'adjustment' ledger entry (never rewrites the
     * original charge lines) so the transaction history stays an honest
     * audit trail, same pattern as a session price correction.
     */
    public function adjustTotal(Invoice $invoice, float $newTotal): Invoice
    {
        abort_if($invoice->status === 'void', 422, 'الفاتورة ملغاة — ما فيك تعدّلها.');
        abort_if($newTotal < 0, 422, 'المبلغ ما فيه يكون سالب.');

        $delta = round($newTotal - (float) $invoice->total_amount_ils, 2);

        if ($delta === 0.0) {
            return $invoice;
        }

        return DB::transaction(function () use ($invoice, $newTotal, $delta) {
            $invoice->update(['total_amount_ils' => $newTotal]);

            PatientTransaction::create([
                'clinic_id' => $invoice->clinic_id,
                'patient_id' => $invoice->patient_id,
                'type' => 'adjustment',
                'reference_type' => 'invoice_discount',
                'reference_id' => $invoice->id,
                'amount' => $delta,
                'currency' => 'ILS',
                'exchange_rate' => 1,
                'amount_ils' => $delta,
                'occurred_at' => now(),
            ]);

            $this->refreshInvoiceStatus($invoice->fresh());

            return $invoice->fresh(['lines', 'payments']);
        });
    }

    public function refreshInvoiceStatus(Invoice $invoice): void
    {
        $paidIls = Payment::where('invoice_id', $invoice->id)->sum('amount_ils');

        $status = match (true) {
            $paidIls <= 0 => 'unpaid',
            $paidIls < $invoice->total_amount_ils => 'partial',
            default => 'paid',
        };

        $invoice->update(['status' => $status]);
    }
}
