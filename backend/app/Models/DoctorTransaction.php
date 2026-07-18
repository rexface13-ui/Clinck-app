<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DoctorTransaction extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'doctor_id', 'tooth_finding_id', 'type',
        'amount_ils', 'period_month', 'settled_at',
    ];

    protected function casts(): array
    {
        return [
            'amount_ils' => 'decimal:2',
            'period_month' => 'date',
            'settled_at' => 'datetime',
        ];
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function toothFinding(): BelongsTo
    {
        return $this->belongsTo(ToothFinding::class);
    }
}
