<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class WorkItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'patient_id' => $this->patient_id,
            'doctor_id' => $this->doctor_id,
            'doctor_name' => $this->whenLoaded('doctor', fn () => $this->doctor?->full_name),
            'service_id' => $this->service_id,
            'service_name' => $this->whenLoaded('service', fn () => $this->service?->name),
            'service_color' => $this->whenLoaded('service', fn () => $this->service?->color),
            'service_spans_teeth' => $this->whenLoaded('service', fn () => (bool) $this->service?->spans_teeth),
            'appointment_id' => $this->appointment_id,
            'price_per_tooth' => $this->price_per_tooth,
            'status' => $this->status,
            'created_at' => display_datetime($this->created_at),
            'teeth' => $this->whenLoaded('teeth', fn () => $this->teeth->pluck('tooth_number')->map(fn ($n) => (int) $n)->values()),
            'steps' => $this->whenLoaded('steps', fn () => $this->steps->map(fn ($step) => [
                'id' => $step->id,
                'title' => $step->title,
                'price' => $step->price,
                'sort_order' => $step->sort_order,
                'fields' => $step->serviceStep?->fields?->map(fn ($f) => ['id' => $f->id, 'label' => $f->label]) ?? [],
                'tooth_steps' => $step->relationLoaded('toothSteps') ? $step->toothSteps->map(fn ($ts) => [
                    'id' => $ts->id,
                    'tooth_number' => (int) $ts->tooth_number,
                    'field_values' => $ts->field_values ?? (object) [],
                    'completed' => $ts->completed_at !== null,
                    'invoiced' => $ts->invoice_line_id !== null,
                    'invoice_id' => $ts->invoiceLine?->invoice_id,
                    // Only meaningful once invoiced (billed) — that's what marks a
                    // tooth-step as belonging to an already-closed prior session,
                    // as opposed to something just checked off today.
                    'completed_at' => $ts->completed_at ? display_datetime($ts->completed_at) : null,
                ]) : [],
            ])),
        ];
    }
}
