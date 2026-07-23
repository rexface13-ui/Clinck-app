<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;

class ActivityLog extends Model
{
    use BelongsToClinic;

    public $timestamps = false;

    protected $fillable = ['clinic_id', 'user_id', 'user_name', 'action', 'description'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public static function record(string $action, string $description): void
    {
        $user = Auth::user();

        static::create([
            'user_id' => $user?->id,
            'user_name' => $user?->name ?? 'النظام',
            'action' => $action,
            'description' => $description,
        ]);
    }
}
