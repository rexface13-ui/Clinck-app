<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AppointmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'patient_id' => $this->patient_id,
            'patient_name' => $this->whenLoaded('patient', fn () => $this->patient?->full_name),
            'doctor_id' => $this->doctor_id,
            'doctor_name' => $this->whenLoaded('doctor', fn () => $this->doctor?->full_name),
            'starts_at' => $this->starts_at?->toIso8601String(),
            'ends_at' => $this->ends_at?->toIso8601String(),
            'starts_at_display' => display_datetime($this->starts_at),
            'status' => $this->status,
            'created_via' => $this->created_via,
            'notes' => $this->notes,
            'work_items' => $this->whenLoaded('workItems', fn () => $this->workItems->map(fn ($w) => [
                'id' => $w->id,
                'service_name' => $w->service?->name,
                'doctor_name' => $w->doctor?->full_name,
                'status' => $w->status,
            ])),
        ];
    }
}
