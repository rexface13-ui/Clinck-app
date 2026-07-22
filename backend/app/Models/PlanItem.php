<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PlanItem extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'treatment_plan_id', 'service_id', 'tooth_number', 'batch_id',
        'surfaces', 'unit_price', 'currency', 'sessions_count', 'interval_days',
    ];

    protected function casts(): array
    {
        return ['unit_price' => 'decimal:2'];
    }

    public function treatmentPlan(): BelongsTo
    {
        return $this->belongsTo(TreatmentPlan::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(PlanItemSession::class);
    }
}
