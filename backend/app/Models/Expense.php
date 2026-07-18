<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Expense extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'expense_category_id', 'cashbox_id',
        'amount', 'currency', 'amount_ils', 'description', 'spent_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'amount_ils' => 'decimal:2',
            'spent_at' => 'datetime',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ExpenseCategory::class, 'expense_category_id');
    }

    public function cashbox(): BelongsTo
    {
        return $this->belongsTo(Cashbox::class);
    }
}
