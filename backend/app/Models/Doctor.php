<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Doctor extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'user_id', 'full_name', 'contract_type',
        'commission_direction', 'default_commission_percent',
        'monthly_salary', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'default_commission_percent' => 'decimal:2',
            'monthly_salary' => 'decimal:2',
            'is_active' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function serviceCommissions(): HasMany
    {
        return $this->hasMany(DoctorServiceCommission::class);
    }

    public function availability(): HasMany
    {
        return $this->hasMany(DoctorAvailability::class);
    }

    public function appointments(): HasMany
    {
        return $this->hasMany(Appointment::class);
    }

    public function toothFindings(): HasMany
    {
        return $this->hasMany(ToothFinding::class);
    }

    public function telegramLink(): HasOne
    {
        return $this->hasOne(TelegramLink::class)->whereNotNull('linked_at');
    }
}
