<?php

namespace App\Services;

use App\Models\Cashbox;
use App\Models\CashboxTransaction;

class CashboxService
{
    /**
     * Records a cashbox movement and updates the running balance in one
     * place — every write path (expenses, incomes, payments, and later
     * checks) must go through here so balance_after is always accurate.
     */
    public function record(Cashbox $cashbox, string $type, string $referenceType, int $referenceId, float $signedAmount): CashboxTransaction
    {
        $newBalance = $cashbox->balance + $signedAmount;

        $transaction = CashboxTransaction::create([
            'clinic_id' => $cashbox->clinic_id,
            'cashbox_id' => $cashbox->id,
            'type' => $type,
            'reference_type' => $referenceType,
            'reference_id' => $referenceId,
            'amount' => $signedAmount,
            'balance_after' => $newBalance,
            'occurred_at' => now(),
        ]);

        $cashbox->update(['balance' => $newBalance]);

        return $transaction;
    }
}
