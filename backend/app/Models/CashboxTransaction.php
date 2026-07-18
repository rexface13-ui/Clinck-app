<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class CashboxTransaction extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'cashbox_id', 'type', 'reference_type', 'reference_id',
        'amount', 'balance_after', 'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'balance_after' => 'decimal:2',
            'occurred_at' => 'datetime',
        ];
    }

    public function cashbox(): BelongsTo
    {
        return $this->belongsTo(Cashbox::class);
    }

    public function reference(): MorphTo
    {
        return $this->morphTo();
    }
}
