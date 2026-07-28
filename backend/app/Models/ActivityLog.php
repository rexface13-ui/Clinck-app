<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;

class ActivityLog extends Model
{
    use BelongsToClinic;

    public $timestamps = false;

    protected $fillable = ['clinic_id', 'user_id', 'user_name', 'action', 'description', 'subject_type', 'subject_id'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    /**
     * $subject is optional — most log entries stay a flat, unaddressed
     * line (as before). Passing a model tags the entry so it can be
     * pulled back out for that specific record's own timeline (e.g. an
     * appointment's status history) instead of only the global feed.
     */
    public static function record(string $action, string $description, ?Model $subject = null): void
    {
        $user = Auth::user();

        static::create([
            'user_id' => $user?->id,
            'user_name' => $user?->name ?? 'النظام',
            'action' => $action,
            'description' => $description,
            'subject_type' => $subject ? get_class($subject) : null,
            'subject_id' => $subject?->getKey(),
        ]);
    }
}
