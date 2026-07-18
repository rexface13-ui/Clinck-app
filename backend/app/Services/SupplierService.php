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
     * owe) and payments reduce that balance.
     */
    public function pay(
        Supplier $supplier,
        Cashbox $cashbox,
        float $amount,
        string $currency,
        float $exchangeRate,
        CashboxService $cashboxService,
    ): SupplierTransaction {
        abort_if($cashbox->currency !== $currency, 422, 'عملة الدفعة لازم تطابق عملة الصندوق.');

        return DB::transaction(function () use ($supplier, $cashbox, $amount, $currency, $exchangeRate, $cashboxService) {
            $amountIls = round($amount * $exchangeRate, 2);

            $transaction = SupplierTransaction::create([
                'clinic_id' => $supplier->clinic_id,
                'supplier_id' => $supplier->id,
                'type' => 'payment',
                'reference_type' => 'supplier',
                'reference_id' => $supplier->id,
                'amount_ils' => -$amountIls,
                'occurred_at' => now(),
            ]);

            $cashboxService->record($cashbox, 'expense_out', 'supplier_transaction', $transaction->id, -$amount);

            return $transaction->fresh('supplier');
        });
    }
}
