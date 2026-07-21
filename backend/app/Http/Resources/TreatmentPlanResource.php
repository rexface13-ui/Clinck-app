<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class TreatmentPlanResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'patient_id' => $this->patient_id,
            'doctor_id' => $this->doctor_id,
            'doctor_name' => $this->whenLoaded('doctor', fn () => $this->doctor?->full_name),
            'status' => $this->status,
            'approved_at' => display_date($this->approved_at),
            'notes' => $this->notes,
            'items' => PlanItemResource::collection($this->whenLoaded('items')),
            'latest_invoice_id' => $this->invoices()->latest('id')->value('id'),
            'created_at' => display_date($this->created_at),
        ];
    }
}
