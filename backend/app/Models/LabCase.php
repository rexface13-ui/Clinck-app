<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LabCase extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'patient_id', 'doctor_id', 'supplier_id', 'description',
        'tooth_numbers', 'sent_at', 'expected_return_date', 'status', 'notes', 'received_at',
    ];

    protected function casts(): array
    {
        return [
            'tooth_numbers' => 'array',
            'sent_at' => 'date',
            'expected_return_date' => 'date',
            'received_at' => 'datetime',
        ];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }
}
