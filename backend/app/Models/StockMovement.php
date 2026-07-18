<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class StockMovement extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'branch_id', 'item_id', 'item_lot_id', 'type',
        'quantity', 'reference_type', 'reference_id', 'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'occurred_at' => 'datetime',
        ];
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function reference(): MorphTo
    {
        return $this->morphTo();
    }
}
