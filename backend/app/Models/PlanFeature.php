<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PlanFeature extends Model
{
    protected $fillable = ['plan_id', 'key', 'enabled'];

    protected function casts(): array
    {
        return ['enabled' => 'boolean'];
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(Plan::class);
    }
}
