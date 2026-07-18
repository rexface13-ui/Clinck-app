<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Item extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'item_category_id', 'name', 'type', 'unit', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ItemCategory::class, 'item_category_id');
    }

    public function lots(): HasMany
    {
        return $this->hasMany(ItemLot::class);
    }

    public function supplierPrices(): HasMany
    {
        return $this->hasMany(ItemSupplierPrice::class);
    }
}
