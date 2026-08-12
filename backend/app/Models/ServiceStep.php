<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ServiceStep extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'service_id', 'title', 'price', 'sort_order'];

    protected function casts(): array
    {
        return ['price' => 'decimal:2'];
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }

    public function fields(): HasMany
    {
        return $this->hasMany(ServiceStepField::class)->orderBy('sort_order');
    }
}
