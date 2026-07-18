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
        'path', 'original_name', 'mime_type', 'size_bytes', 'uploaded_by',
    ];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
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
