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
    ];

    protected function casts(): array
    {
        return ['linked_at' => 'datetime'];
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
