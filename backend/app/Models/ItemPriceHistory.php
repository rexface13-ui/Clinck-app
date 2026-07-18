<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ItemPriceHistory extends Model
{
    use BelongsToClinic;

    protected $table = 'item_price_history';

    protected $fillable = [
        'clinic_id', 'item_id', 'supplier_id', 'price', 'currency',
        'purchase_invoice_id', 'recorded_at',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'recorded_at' => 'datetime',
        ];
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }
}
