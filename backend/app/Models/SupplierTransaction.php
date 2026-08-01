<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class SupplierTransaction extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'supplier_id', 'type', 'reference_type', 'reference_id',
        'amount_ils', 'notes', 'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'amount_ils' => 'decimal:2',
            'occurred_at' => 'datetime',
        ];
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    public function reference(): MorphTo
    {
        return $this->morphTo();
    }
}
