<?php

namespace App\Services;

use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\CheckModel;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Models\WorkItemToothStep;
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
     * Hands money back out of a cashbox against a patient/invoice — the
     * mirror of collect(): a negative Payment, a cashbox 'adjustment'
     * movement that shrinks its balance, and a 'refund' ledger entry.
     * Used when a session's recorded collected amount is corrected downward.
     */
    public function refund(
        Patient $patient,
        Cashbox $cashbox,
        float $amount,
        string $currency,
        float $exchangeRate,
        string $method,
        ?Invoice $invoice = null,
    ): Payment {
        abort_if($cashbox->currency !== $currency, 422, 'عملة الاسترجاع لازم تطابق عملة الصندوق.');
        abort_if($invoice && $invoice->patient_id !== $patient->id, 422, 'الفاتورة لا تخص هذا المريض.');

        return DB::transaction(function () use ($patient, $cashbox, $amount, $currency, $exchangeRate, $method, $invoice) {
            $amountIls = round($amount * $exchangeRate, 2);

            $payment = Payment::create([
                'clinic_id' => $patient->clinic_id,
                'patient_id' => $patient->id,
                'invoice_id' => $invoice?->id,
                'cashbox_id' => $cashbox->id,
                'amount' => -$amount,
                'currency' => $currency,
                'exchange_rate' => $exchangeRate,
                'amount_ils' => -$amountIls,
                'method' => $method,
                'paid_at' => now(),
            ]);

            $newBalance = $cashbox->balance - $amount;
            CashboxTransaction::create([
                'clinic_id' => $patient->clinic_id,
                'cashbox_id' => $cashbox->id,
                'type' => 'adjustment',
                'reference_type' => 'payment',
                'reference_id' => $payment->id,
                'amount' => -$amount,
                'balance_after' => $newBalance,
                'occurred_at' => now(),
            ]);
            $cashbox->update(['balance' => $newBalance]);

            PatientTransaction::create([
                'clinic_id' => $patient->clinic_id,
                'patient_id' => $patient->id,
                'type' => 'refund',
                'reference_type' => 'payment',
                'reference_id' => $payment->id,
                'amount' => -$amount,
                'currency' => $currency,
                'exchange_rate' => $exchangeRate,
                'amount_ils' => -$amountIls,
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

    /**
     * Corrects an already-entered payment/refund in place — reverses its old
     * cashbox effect, applies the new one (same or different cashbox), keeps
     * the original payment/refund direction (a payment can't be edited into
     * a refund or vice versa), and re-derives the invoice status. Keeps the
     * same Payment row (not delete+recreate) so it stays the same audit
     * trail entry, just corrected.
     */
    public function updatePayment(Payment $payment, Cashbox $cashbox, float $amount, float $exchangeRate, string $method): Payment
    {
        abort_if($cashbox->currency !== $payment->currency, 422, 'عملة الدفعة لازم تطابق عملة الصندوق.');
        abort_if($amount <= 0, 422, 'المبلغ لازم يكون أكبر من صفر.');

        $sign = $payment->amount < 0 ? -1 : 1;
        $signedAmount = $sign * $amount;
        $signedAmountIls = round($signedAmount * $exchangeRate, 2);

        return DB::transaction(function () use ($payment, $cashbox, $signedAmount, $exchangeRate, $signedAmountIls, $method) {
            $oldCashbox = $payment->cashbox;
            if ($oldCashbox) {
                $revertedBalance = $oldCashbox->balance - $payment->amount;
                CashboxTransaction::create([
                    'clinic_id' => $payment->clinic_id,
                    'cashbox_id' => $oldCashbox->id,
                    'type' => 'adjustment',
                    'reference_type' => 'payment_edited',
                    'reference_id' => $payment->id,
                    'amount' => -$payment->amount,
                    'balance_after' => $revertedBalance,
                    'occurred_at' => now(),
                ]);
                $oldCashbox->update(['balance' => $revertedBalance]);
            }

            $cashbox->refresh();
            $newBalance = $cashbox->balance + $signedAmount;
            CashboxTransaction::create([
                'clinic_id' => $payment->clinic_id,
                'cashbox_id' => $cashbox->id,
                'type' => 'adjustment',
                'reference_type' => 'payment_edited',
                'reference_id' => $payment->id,
                'amount' => $signedAmount,
                'balance_after' => $newBalance,
                'occurred_at' => now(),
            ]);
            $cashbox->update(['balance' => $newBalance]);

            PatientTransaction::where('reference_type', 'payment')->where('reference_id', $payment->id)->delete();
            PatientTransaction::create([
                'clinic_id' => $payment->clinic_id,
                'patient_id' => $payment->patient_id,
                'type' => $signedAmount < 0 ? 'refund' : 'payment',
                'reference_type' => 'payment',
                'reference_id' => $payment->id,
                'amount' => $signedAmount,
                'currency' => $payment->currency,
                'exchange_rate' => $exchangeRate,
                'amount_ils' => $signedAmountIls,
                'occurred_at' => now(),
            ]);

            $payment->update([
                'cashbox_id' => $cashbox->id,
                'amount' => $signedAmount,
                'exchange_rate' => $exchangeRate,
                'amount_ils' => $signedAmountIls,
                'method' => $method,
            ]);

            if ($payment->invoice_id) {
                $this->refreshInvoiceStatus($payment->invoice->fresh());
            }

            return $payment->fresh(['cashbox', 'invoice']);
        });
    }

    /**
     * Deletes an invoice from the patient's account completely — e.g. it was
     * created by mistake. Unlike a soft void, this actually removes the
     * charge and every ledger row tied to it (no leftover "discount" line),
     * and un-bills whatever work was on it (tooth-steps go back to
     * not-yet-invoiced). Blocked if payments were already collected against
     * it — delete/reassign those first, since real cash changed hands and
     * silently orphaning it would be worse than refusing.
     */
    public function deleteInvoice(Invoice $invoice): void
    {
        abort_if($invoice->payments()->exists(), 422, 'في دفعات مسجّلة عالفاتورة هاي — احذفهم أول قبل ما تحذف الفاتورة.');

        DB::transaction(function () use ($invoice) {
            WorkItemToothStep::whereIn('invoice_line_id', $invoice->lines()->pluck('id'))
                ->update(['completed_at' => null, 'invoice_line_id' => null]);

            PatientTransaction::where('reference_id', $invoice->id)
                ->whereIn('reference_type', ['invoice', 'invoice_discount', 'invoice_line_reversal', 'invoice_line_reprice', 'invoice_void'])
                ->delete();

            $invoice->lines()->delete();
            $invoice->delete();
        });
    }

    /**
     * Deletes a correction-type ledger entry (a manual discount, a
     * price-reversal from deleting billed work, a line reprice) as if it
     * never happened — undoes its effect on the invoice total first, if it
     * had one, then removes the row. Deliberately scoped to 'adjustment'
     * rows only: a 'charge' (the original invoice line) or 'payment' isn't
     * a standalone correction, deleting those needs to go through voiding
     * the invoice / PaymentService::deletePayment() instead, which handle
     * the wider blast radius (invoice lines, cashbox) correctly.
     */
    public function deleteAdjustment(PatientTransaction $transaction): void
    {
        abort_unless($transaction->type === 'adjustment', 422, 'هاي الحركة مش خصم/تصحيح — ما فيك تحذفها من هون.');

        DB::transaction(function () use ($transaction) {
            $invoiceReferenceTypes = ['invoice_discount', 'invoice_line_reversal', 'invoice_line_reprice'];

            if (in_array($transaction->reference_type, $invoiceReferenceTypes, true) && $transaction->reference_id) {
                $invoice = Invoice::withoutGlobalScopes()->find($transaction->reference_id);
                if ($invoice) {
                    $restored = max(0, (float) $invoice->total_amount_ils - (float) $transaction->amount_ils);
                    $invoice->update(['total_amount_ils' => $restored]);
                    $this->refreshInvoiceStatus($invoice->fresh());
                }
            }

            $transaction->delete();
        });
    }

    /**
     * Corrects a discount's amount in place — general (patient_discount) or
     * per-invoice (invoice_discount) only; system-generated corrections
     * (invoice_line_reversal/reprice) aren't user-entered discounts and
     * aren't editable here. Re-applies the new amount's effect on the
     * invoice total (if any) by the delta from the old amount, same as
     * updatePayment() does for the cashbox.
     */
    public function updateAdjustment(PatientTransaction $transaction, float $newAmount): PatientTransaction
    {
        abort_unless($transaction->type === 'adjustment', 422, 'هاي الحركة مش خصم — ما فيك تعدّلها من هون.');
        abort_unless(in_array($transaction->reference_type, ['patient_discount', 'invoice_discount'], true), 422, 'هاي الحركة مش خصم قابل للتعديل.');
        abort_if($newAmount <= 0, 422, 'المبلغ لازم يكون أكبر من صفر.');

        return DB::transaction(function () use ($transaction, $newAmount) {
            $newSignedAmount = -$newAmount;
            $delta = round($newSignedAmount - (float) $transaction->amount_ils, 2);

            if ($transaction->reference_type === 'invoice_discount' && $transaction->reference_id) {
                $invoice = Invoice::withoutGlobalScopes()->find($transaction->reference_id);
                if ($invoice) {
                    $invoice->update(['total_amount_ils' => max(0, (float) $invoice->total_amount_ils + $delta)]);
                    $this->refreshInvoiceStatus($invoice->fresh());
                }
            }

            $transaction->update(['amount' => $newSignedAmount, 'amount_ils' => $newSignedAmount]);

            return $transaction->fresh();
        });
    }

    /**
     * Undoes a wrongly-entered payment (or refund) as if it never happened —
     * reverses the cashbox balance it moved, removes its ledger trace, and
     * re-derives the invoice's paid status, then deletes the payment row
     * itself. The clinic's own workflow for "fix a payment" is delete +
     * re-enter correctly, not an in-place amount edit — much less error-prone
     * than trying to replay a delta across cashbox/ledger/invoice at once.
     */
    public function deletePayment(Payment $payment): void
    {
        DB::transaction(function () use ($payment) {
            $cashbox = $payment->cashbox;
            if ($cashbox) {
                $newBalance = $cashbox->balance - $payment->amount;
                CashboxTransaction::create([
                    'clinic_id' => $payment->clinic_id,
                    'cashbox_id' => $cashbox->id,
                    'type' => 'adjustment',
                    'reference_type' => 'payment_deleted',
                    'reference_id' => $payment->id,
                    'amount' => -$payment->amount,
                    'balance_after' => $newBalance,
                    'occurred_at' => now(),
                ]);
                $cashbox->update(['balance' => $newBalance]);
            }

            PatientTransaction::where('reference_type', 'payment')->where('reference_id', $payment->id)->delete();

            $invoice = $payment->invoice;
            $payment->delete();

            if ($invoice) {
                $this->refreshInvoiceStatus($invoice->fresh());
            }
        });
    }

    /**
     * Re-derives an invoice's paid status from everything that actually
     * settled it: cash/card/transfer payments, plus any patient check applied
     * to it. A check counts from the moment it's in hand (not when it clears)
     * — that's the same point CheckService::receive() credits the patient's
     * ledger, and bounce() puts both back. Leaving checks out was why a
     * patient could owe nothing and still have invoices reading "غير مدفوعة".
     */
    public function refreshInvoiceStatus(Invoice $invoice): void
    {
        $paidIls = (float) Payment::where('invoice_id', $invoice->id)->sum('amount_ils');

        $paidIls += (float) CheckModel::where('invoice_id', $invoice->id)
            ->where('direction', 'incoming')
            ->where('party_type', 'patient')
            ->where('status', '!=', 'bounced')
            ->sum('amount');

        $total = (float) $invoice->total_amount_ils;

        $status = match (true) {
            // A zero-total invoice (everything on it was discounted or
            // reversed away) has nothing left owing — it's settled, not
            // "unpaid" forever.
            $total <= 0 => 'paid',
            $paidIls <= 0 => 'unpaid',
            $paidIls < $total => 'partial',
            default => 'paid',
        };

        $invoice->update(['status' => $status]);
    }
}
