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

    protected function refreshInvoiceStatus(Invoice $invoice): void
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
