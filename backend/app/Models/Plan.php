<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Plan extends Model
{
    protected $fillable = [
        'name', 'price_ils', 'max_users', 'max_branches',
        'max_patients', 'storage_mb', 'is_active',
    ];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function planFeatures(): HasMany
    {
        return $this->hasMany(PlanFeature::class);
    }
}
