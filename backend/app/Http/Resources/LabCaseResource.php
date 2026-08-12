<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LabCaseResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'patient_id' => $this->patient_id,
            'patient_name' => $this->whenLoaded('patient', fn () => $this->patient?->full_name),
            'doctor_id' => $this->doctor_id,
            'doctor_name' => $this->whenLoaded('doctor', fn () => $this->doctor?->full_name),
            'supplier_id' => $this->supplier_id,
            'supplier_name' => $this->whenLoaded('supplier', fn () => $this->supplier?->name),
            'description' => $this->description,
            'tooth_numbers' => $this->tooth_numbers,
            'sent_at' => display_date($this->sent_at),
            'expected_return_date' => display_date($this->expected_return_date),
            'status' => $this->status,
            'notes' => $this->notes,
            'received_at' => $this->received_at ? display_datetime($this->received_at) : null,
            'is_overdue' => $this->status !== 'received' && $this->expected_return_date && $this->expected_return_date->isPast(),
        ];
    }
}
