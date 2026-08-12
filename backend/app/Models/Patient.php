<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use App\Models\Concerns\HasNotesAndAttachments;
use App\Support\Tenancy\CurrentClinic;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Patient extends Model
{
    use BelongsToClinic, HasNotesAndAttachments;

    protected $fillable = [
        'clinic_id', 'branch_id', 'code', 'full_name', 'birth_date', 'age', 'gender',
        'is_child', 'phone', 'guardian_name', 'guardian_phone', 'medical_alerts', 'medical_notes',
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
                // age (plain number staff actually know) takes priority —
                // birth_date is legacy/optional and only used as a fallback
                // for records that happen to have one but no age set.
                $patient->is_child = $patient->age !== null
                    ? $patient->age < 12
                    : ($patient->birth_date ? Carbon::parse($patient->birth_date)->age < 12 : false);
            }
        });
    }

    protected static function nextCode(): string
    {
        $lastCode = static::withoutGlobalScopes()
            ->where('clinic_id', CurrentClinic::id())
            ->whereRaw("code ~ '^P-[0-9]+$'")
            ->orderByRaw("CAST(SUBSTRING(code FROM 3) AS INTEGER) DESC")
            ->lockForUpdate()
            ->value('code');

        $next = $lastCode ? ((int) substr($lastCode, 2)) + 1 : 1;

        return sprintf('P-%06d', $next);
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

    public function workItems(): HasMany
    {
        return $this->hasMany(WorkItem::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(PatientTransaction::class);
    }

    public function telegramLink(): HasOne
    {
        return $this->hasOne(TelegramLink::class)->whereNotNull('linked_at');
    }
}
