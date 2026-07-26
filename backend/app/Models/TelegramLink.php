<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TelegramLink extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'user_id', 'patient_id', 'telegram_chat_id', 'link_code',
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
}
