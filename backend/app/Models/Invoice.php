<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Invoice extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'patient_id', 'treatment_plan_id', 'invoice_number',
        'status', 'total_amount_ils', 'issued_at',
    ];

    protected function casts(): array
    {
        return [
            'total_amount_ils' => 'decimal:2',
            'issued_at' => 'datetime',
        ];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function treatmentPlan(): BelongsTo
    {
        return $this->belongsTo(TreatmentPlan::class);
    }

    public function lines(): HasMany
    {
        return $this->hasMany(InvoiceLine::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }
}
