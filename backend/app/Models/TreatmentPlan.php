<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TreatmentPlan extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'patient_id', 'doctor_id', 'status', 'approved_at', 'notes'];

    protected function casts(): array
    {
        return ['approved_at' => 'datetime'];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(PlanItem::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }
}
