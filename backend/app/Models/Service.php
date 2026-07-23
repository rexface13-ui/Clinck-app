<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Service extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'service_category_id', 'name', 'default_price',
        'default_currency', 'default_sessions', 'default_interval_days',
        'default_commission_percent', 'is_active', 'marks_teeth_missing',
    ];

    protected function casts(): array
    {
        return [
            'default_price' => 'decimal:2',
            'default_commission_percent' => 'decimal:2',
            'is_active' => 'boolean',
            'marks_teeth_missing' => 'boolean',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ServiceCategory::class, 'service_category_id');
    }

    public function branchPrices(): HasMany
    {
        return $this->hasMany(BranchServicePrice::class);
    }

    public function doctorCommissions(): HasMany
    {
        return $this->hasMany(DoctorServiceCommission::class);
    }

    public function priceForBranch(Branch $branch): float
    {
        $override = $this->branchPrices->firstWhere('branch_id', $branch->id);

        return (float) (($override->price ?? $this->default_price) + ($override->surcharge ?? 0));
    }
}
