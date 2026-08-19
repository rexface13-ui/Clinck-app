<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PatientRelative extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'patient_id', 'related_patient_id', 'label'];

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function relatedPatient(): BelongsTo
    {
        return $this->belongsTo(Patient::class, 'related_patient_id');
    }
}
