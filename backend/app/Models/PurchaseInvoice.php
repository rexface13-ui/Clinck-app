<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PurchaseInvoice extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'supplier_id', 'branch_id', 'invoice_number',
        'status', 'total_amount_ils', 'discount_amount_ils', 'issued_at', 'notes',
    ];

    protected function casts(): array
    {
        return [
            'total_amount_ils' => 'decimal:2',
            'discount_amount_ils' => 'decimal:2',
            'issued_at' => 'datetime',
        ];
    }

    /**
     * total_amount_ils (what the supplier is actually owed, and what
     * confirm()'s debt/payment amount uses) is always the lines' gross sum
     * minus the discount, clamped so a discount bigger than the invoice
     * doesn't flip it negative.
     */
    public function recomputeTotal(): void
    {
        $gross = (float) $this->lines()->sum('amount_ils');
        $this->update(['total_amount_ils' => max(0, $gross - (float) $this->discount_amount_ils)]);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseInvoiceLine::class);
    }
}
