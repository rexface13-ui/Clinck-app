<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class PatientTransaction extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'patient_id', 'type', 'reference_type', 'reference_id', 'note',
        'amount', 'currency', 'exchange_rate', 'amount_ils', 'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'exchange_rate' => 'decimal:6',
            'amount_ils' => 'decimal:2',
            'occurred_at' => 'datetime',
        ];
    }

    /**
     * What counts as revenue: charges plus every adjustment (discounts,
     * reversals, price corrections — all negative). A returned check is
     * booked as a 'charge' to put the debt back, but it isn't new work —
     * the service was already billed — so counting it would inflate revenue
     * by every bounced check.
     */
    public function scopeRevenue($query)
    {
        return $query->whereIn('type', ['charge', 'adjustment'])
            ->where(fn ($q) => $q->whereNull('reference_type')->orWhere('reference_type', '!=', 'check'));
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function reference(): MorphTo
    {
        return $this->morphTo();
    }
}
