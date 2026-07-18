<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payment extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'patient_id', 'invoice_id', 'cashbox_id',
        'amount', 'currency', 'exchange_rate', 'amount_ils', 'method', 'paid_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'exchange_rate' => 'decimal:6',
            'amount_ils' => 'decimal:2',
            'paid_at' => 'datetime',
        ];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function cashbox(): BelongsTo
    {
        return $this->belongsTo(Cashbox::class);
    }
}
