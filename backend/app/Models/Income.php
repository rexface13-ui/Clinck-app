<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Income extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'income_category_id', 'cashbox_id',
        'amount', 'currency', 'amount_ils', 'description', 'received_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'amount_ils' => 'decimal:2',
            'received_at' => 'datetime',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(IncomeCategory::class, 'income_category_id');
    }

    public function cashbox(): BelongsTo
    {
        return $this->belongsTo(Cashbox::class);
    }
}
