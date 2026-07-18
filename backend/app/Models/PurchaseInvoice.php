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
        'status', 'total_amount_ils', 'issued_at',
    ];

    protected function casts(): array
    {
        return [
            'total_amount_ils' => 'decimal:2',
            'issued_at' => 'datetime',
        ];
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
