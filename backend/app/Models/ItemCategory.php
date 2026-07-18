<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ItemCategory extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'name'];

    public function items(): HasMany
    {
        return $this->hasMany(Item::class);
    }
}
