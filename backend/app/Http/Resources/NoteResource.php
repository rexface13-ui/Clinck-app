<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class NoteResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'body' => $this->body,
            'author' => $this->whenLoaded('user', fn () => $this->user->name),
            'created_at' => display_datetime($this->created_at),
            'tooth_number' => $this->tooth_number,
            'is_important' => (bool) $this->is_important,
            'work_item_id' => $this->work_item_id,
            'session_label' => $this->work_item_id
                ? sprintf('%s — %s', $this->workItem->service?->name ?? 'جلسة', display_datetime($this->workItem->created_at))
                : null,
        ];
    }
}
