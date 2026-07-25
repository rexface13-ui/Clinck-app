<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WorkItem extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'patient_id', 'doctor_id', 'service_id', 'appointment_id', 'price_per_tooth', 'status'];

    protected function casts(): array
    {
        return ['price_per_tooth' => 'boolean'];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }

    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }

    public function teeth(): HasMany
    {
        return $this->hasMany(WorkItemTooth::class);
    }

    public function steps(): HasMany
    {
        return $this->hasMany(WorkItemStep::class)->orderBy('sort_order');
    }

    public function toothSteps(): HasMany
    {
        return $this->hasMany(WorkItemToothStep::class);
    }

    public function toothNumbers(): array
    {
        return $this->teeth->pluck('tooth_number')->map(fn ($n) => (int) $n)->all();
    }
}
