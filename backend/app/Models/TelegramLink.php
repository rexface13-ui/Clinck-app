<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TelegramLink extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'user_id', 'patient_id', 'doctor_id', 'telegram_chat_id', 'link_code',
        'registered_name', 'registered_phone', 'pending_check_id', 'linked_at',
        'booking_step', 'booking_doctor_id', 'booking_date',
    ];

    protected function casts(): array
    {
        return ['linked_at' => 'datetime', 'booking_date' => 'date'];
    }

    public function bookingDoctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class, 'booking_doctor_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    /**
     * Resolves the active Telegram chat to notify a doctor on — a direct
     * doctor_id link (doctor registered by name, no User login) takes
     * priority, falling back to the doctor's own User account link if any.
     */
    public static function activeForDoctor(?Doctor $doctor): ?self
    {
        if (! $doctor) {
            return null;
        }

        return static::where('doctor_id', $doctor->id)->whereNotNull('linked_at')->first()
            ?? ($doctor->user_id ? static::where('user_id', $doctor->user_id)->whereNotNull('linked_at')->first() : null);
    }
}
