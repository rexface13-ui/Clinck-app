<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class Attachment extends Model
{
    use BelongsToClinic;

    public $timestamps = false;

    protected $fillable = [
        'clinic_id', 'attachable_type', 'attachable_id', 'disk',
        'path', 'original_name', 'title', 'mime_type', 'size_bytes', 'uploaded_by',
    ];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        // $timestamps is disabled (no updated_at column) but created_at still
        // exists and is displayed — nothing else sets it, so without this it
        // silently inserts as null on every upload.
        static::creating(function (Attachment $attachment): void {
            $attachment->created_at ??= now();
        });
    }

    public function attachable(): MorphTo
    {
        return $this->morphTo();
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }
}
