<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use App\Models\Concerns\HasNotesAndAttachments;
use App\Support\Tenancy\CurrentClinic;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Patient extends Model
{
    use BelongsToClinic, HasNotesAndAttachments;

    protected $fillable = [
        'clinic_id', 'branch_id', 'code', 'full_name', 'birth_date', 'gender',
        'is_child', 'phone', 'guardian_name', 'guardian_phone', 'medical_alerts',
    ];

    protected function casts(): array
    {
        return [
            'birth_date' => 'date',
            'is_child' => 'boolean',
            'medical_alerts' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Patient $patient): void {
            if (! $patient->code) {
                $patient->code = self::nextCode();
            }

            if (is_null($patient->getAttribute('is_child'))) {
                $patient->is_child = $patient->birth_date
                    ? Carbon::parse($patient->birth_date)->age < 12
                    : false;
            }
        });
    }

    protected static function nextCode(): string
    {
        $count = static::withoutGlobalScopes()
            ->where('clinic_id', CurrentClinic::id())
            ->count();

        return sprintf('P-%06d', $count + 1);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function toothStates(): HasMany
    {
        return $this->hasMany(ToothState::class);
    }

    public function toothFindings(): HasMany
    {
        return $this->hasMany(ToothFinding::class);
    }

    public function appointments(): HasMany
    {
        return $this->hasMany(Appointment::class);
    }

    public function treatmentPlans(): HasMany
    {
        return $this->hasMany(TreatmentPlan::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(PatientTransaction::class);
    }
}
