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
        'clinic_id', 'treatment_plan_id', 'service_id', 'tooth_number', 'tooth_numbers', 'batch_id',
        'surfaces', 'unit_price', 'currency', 'sessions_count', 'interval_days',
    ];

    protected function casts(): array
    {
        return ['unit_price' => 'decimal:2', 'tooth_numbers' => 'array'];
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

    /** All teeth this item covers — tooth_numbers if set (multi-tooth item), else the single tooth_number, else empty for a whole-mouth service with no tooth at all. */
    public function allTeeth(): array
    {
        if (! empty($this->tooth_numbers)) {
            return $this->tooth_numbers;
        }

        return $this->tooth_number ? [$this->tooth_number] : [];
    }

    /** Teeth from this item's pool already fully finished (a 'done' finding for this service) — permanently off-limits to future sessions. */
    public function doneTeeth(): array
    {
        $pool = $this->allTeeth();
        if (empty($pool)) {
            return [];
        }

        return ToothFinding::where('patient_id', $this->treatmentPlan->patient_id)
            ->where('service_id', $this->service_id)
            ->whereIn('tooth_number', $pool)
            ->where('status', 'done')
            ->pluck('tooth_number')
            ->all();
    }

    /** Teeth still workable — the pool minus whatever's already fully done. What a new session should offer/pre-select. */
    public function remainingTeeth(): array
    {
        return array_values(array_diff($this->allTeeth(), $this->doneTeeth()));
    }
}
