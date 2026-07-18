<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ItemSupplierPrice extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'item_id', 'supplier_id', 'last_price', 'currency'];

    protected function casts(): array
    {
        return ['last_price' => 'decimal:2'];
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
