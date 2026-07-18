<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TelegramLink extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'user_id', 'telegram_chat_id', 'link_code', 'linked_at'];

    protected function casts(): array
    {
        return ['linked_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
