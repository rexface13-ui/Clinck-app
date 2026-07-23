<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ToothFindingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tooth_number' => (int) $this->tooth_number,
            'surfaces' => $this->surfaces,
            'finding_type' => $this->finding_type,
            'status' => $this->status,
            'marks_missing' => (bool) $this->marks_missing,
            'performed_externally' => (bool) $this->performed_externally,
            'plan_item_session_id' => $this->plan_item_session_id,
            'session_status' => $this->whenLoaded('planItemSession', fn () => $this->planItemSession?->status),
            'session_price' => $this->whenLoaded('planItemSession', fn () => $this->planItemSession?->invoiceLine?->amount_ils),
            'plan_id' => $this->whenLoaded('planItemSession', fn () => $this->planItemSession?->planItem?->treatment_plan_id),
            'plan_item_id' => $this->whenLoaded('planItemSession', fn () => $this->planItemSession?->plan_item_id),
            'service_id' => $this->service_id,
            'service_name' => $this->whenLoaded('service', fn () => $this->service?->name),
            'doctor_id' => $this->doctor_id,
            'doctor_name' => $this->whenLoaded('doctor', fn () => $this->doctor?->full_name),
            'note' => $this->note,
            'recorded_at' => display_date($this->recorded_at),
        ];
    }
}
