<?php

namespace App\Services;

use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\Supplier;
use App\Models\SupplierTransaction;
use Illuminate\Support\Facades\DB;

class SupplierService
{
    /**
     * Paying a supplier draws from a cashbox (expense_out, negative — same
     * convention as ExpenseController) and posts a negative
     * supplier_transaction, since purchases are stored positive (what we
     * owe) and payments reduce that balance. reference_type/id point back
     * at the transaction itself (not just "supplier") so update()/delete()
     * can find and reverse the exact cashbox movement this payment made.
     */
    public function pay(
        Supplier $supplier,
        Cashbox $cashbox,
        float $amount,
        string $currency,
        float $exchangeRate,
        CashboxService $cashboxService,
        ?string $notes = null,
        ?string $occurredAt = null,
    ): SupplierTransaction {
        abort_if($cashbox->currency !== $currency, 422, 'عملة الدفعة لازم تطابق عملة الصندوق.');

        return DB::transaction(function () use ($supplier, $cashbox, $amount, $exchangeRate, $cashboxService, $notes, $occurredAt) {
            $amountIls = round($amount * $exchangeRate, 2);

            $transaction = SupplierTransaction::create([
                'clinic_id' => $supplier->clinic_id,
                'supplier_id' => $supplier->id,
                'type' => 'payment',
                'reference_type' => 'supplier',
                'reference_id' => $supplier->id,
                'amount_ils' => -$amountIls,
                'notes' => $notes,
                'occurred_at' => $occurredAt ?? now(),
            ]);

            $cashboxService->record($cashbox, 'expense_out', 'supplier_transaction', $transaction->id, -$amount);

            return $transaction->fresh('supplier');
        });
    }

    /**
     * A discount the supplier agreed to (e.g. off a running balance) reduces
     * what's owed exactly like a payment, but no money actually moves — no
     * cashbox involved.
     */
    public function discount(
        Supplier $supplier,
        float $amount,
        ?string $notes = null,
        ?string $occurredAt = null,
    ): SupplierTransaction {
        $transaction = SupplierTransaction::create([
            'clinic_id' => $supplier->clinic_id,
            'supplier_id' => $supplier->id,
            'type' => 'discount',
            'reference_type' => 'supplier',
            'reference_id' => $supplier->id,
            'amount_ils' => -$amount,
            'notes' => $notes,
            'occurred_at' => $occurredAt ?? now(),
        ]);

        return $transaction->fresh('supplier');
    }

    /**
     * Only payment/discount/adjustment transactions are hand-entered and
     * safe to correct after the fact — purchase, check_endorsed and
     * check_bounced rows are derived from a purchase invoice or a check's
     * own lifecycle and must be corrected there instead, so their own
     * source of truth doesn't drift from what the supplier ledger shows.
     */
    protected function assertEditable(SupplierTransaction $transaction): void
    {
        abort_unless(
            in_array($transaction->type, ['payment', 'discount', 'adjustment'], true),
            422,
            'هذه الحركة مرتبطة بفاتورة شراء أو شيك — عدّلها من هناك بدل كشف حساب المورد.',
        );
    }

    /**
     * Edits amount/notes/date on a manual transaction. If it's a payment
     * backed by a cashbox movement (reference_type=supplier_transaction),
     * the old cashbox effect is reversed and the new one re-applied so the
     * cashbox balance stays correct — same adjustment pattern used to
     * revert a purchase invoice's payment.
     */
    public function update(
        SupplierTransaction $transaction,
        float $amount,
        ?string $notes,
        ?string $occurredAt,
        CashboxService $cashboxService,
    ): SupplierTransaction {
        $this->assertEditable($transaction);

        return DB::transaction(function () use ($transaction, $amount, $notes, $occurredAt, $cashboxService) {
            $signedAmount = $transaction->amount_ils < 0 ? -abs($amount) : abs($amount);

            if ($transaction->type === 'payment') {
                $cashboxTransaction = CashboxTransaction::where('reference_type', 'supplier_transaction')
                    ->where('reference_id', $transaction->id)
                    ->first();

                if ($cashboxTransaction) {
                    $cashbox = Cashbox::find($cashboxTransaction->cashbox_id);
                    if ($cashbox) {
                        // Reverse the old amount, then apply the new one —
                        // both against "now", same as every other
                        // adjustment in this app (cashbox history isn't
                        // rewritten retroactively).
                        $cashboxService->record($cashbox, 'adjustment', 'supplier_transaction', $transaction->id, -(float) $cashboxTransaction->amount);
                        $cashboxService->record($cashbox, 'expense_out', 'supplier_transaction', $transaction->id, -abs($amount));
                    }
                }
            }

            $transaction->update([
                'amount_ils' => $signedAmount,
                'notes' => $notes,
                'occurred_at' => $occurredAt ?? $transaction->occurred_at,
            ]);

            return $transaction->fresh('supplier');
        });
    }

    /** Reverses whatever cashbox effect a manual payment made (if any), then removes the transaction. */
    public function delete(SupplierTransaction $transaction, CashboxService $cashboxService): void
    {
        $this->assertEditable($transaction);

        DB::transaction(function () use ($transaction, $cashboxService) {
            if ($transaction->type === 'payment') {
                $cashboxTransaction = CashboxTransaction::where('reference_type', 'supplier_transaction')
                    ->where('reference_id', $transaction->id)
                    ->first();

                if ($cashboxTransaction) {
                    $cashbox = Cashbox::find($cashboxTransaction->cashbox_id);
                    if ($cashbox) {
                        $cashboxService->record($cashbox, 'adjustment', 'supplier_transaction', $transaction->id, -(float) $cashboxTransaction->amount);
                    }
                }
            }

            $transaction->delete();
        });
    }
}
