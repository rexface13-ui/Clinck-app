<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ToothFinding extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'patient_id', 'tooth_number', 'surfaces', 'finding_type',
        'status', 'marks_missing', 'performed_externally', 'service_id', 'plan_item_session_id',
        'doctor_id', 'note', 'recorded_at',
    ];

    protected function casts(): array
    {
        return ['recorded_at' => 'datetime', 'marks_missing' => 'boolean', 'performed_externally' => 'boolean'];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function planItemSession(): BelongsTo
    {
        return $this->belongsTo(PlanItemSession::class);
    }
}
