<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AttachmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'original_name' => $this->original_name,
            'title' => $this->title,
            // What the list should actually show: the clinic's own label when
            // there is one, the file name only as a fallback.
            'display_name' => $this->title ?: $this->original_name,
            'is_image' => str_starts_with((string) $this->mime_type, 'image/'),
            'mime_type' => $this->mime_type,
            'size_bytes' => $this->size_bytes,
            'uploaded_by' => $this->whenLoaded('uploader', fn () => $this->uploader?->name),
            'created_at' => display_datetime($this->created_at),
            'download_url' => route('attachments.download', $this->id),
        ];
    }
}
