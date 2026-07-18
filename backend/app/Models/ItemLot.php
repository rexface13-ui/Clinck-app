<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ItemLot extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'item_id', 'lot_number', 'expiry_date', 'quantity_remaining'];

    protected function casts(): array
    {
        return [
            'expiry_date' => 'date',
            'quantity_remaining' => 'decimal:3',
        ];
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }
}
