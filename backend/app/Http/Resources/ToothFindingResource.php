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
            'work_item_tooth_step_id' => $this->work_item_tooth_step_id,
            'session_status' => $this->whenLoaded('workItemToothStep', fn () => $this->workItemToothStep?->completed_at ? 'done' : 'pending'),
            'session_price' => $this->whenLoaded('workItemToothStep', fn () => $this->workItemToothStep?->invoiceLine?->amount_ils),
            'plan_id' => $this->whenLoaded('workItemToothStep', fn () => $this->workItemToothStep?->work_item_id),
            // Groups findings from the same visit together in the tooth
            // history — an invoiced finding groups by invoice_id (several
            // services checked out together = one visit); one still
            // in-progress groups by its work item instead, since it has no
            // invoice yet.
            'invoice_id' => $this->whenLoaded('workItemToothStep', fn () => $this->workItemToothStep?->invoiceLine?->invoice_id),
            'step_title' => $this->whenLoaded('workItemToothStep', fn () => $this->workItemToothStep?->step?->title),
            'service_id' => $this->service_id,
            'service_name' => $this->whenLoaded('service', fn () => $this->service?->name),
            'service_color' => $this->whenLoaded('service', fn () => $this->service?->color),
            'service_spans_teeth' => $this->whenLoaded('service', fn () => (bool) $this->service?->spans_teeth),
            'doctor_id' => $this->doctor_id,
            'doctor_name' => $this->whenLoaded('doctor', fn () => $this->doctor?->full_name),
            'note' => $this->note,
            'recorded_at' => display_date($this->recorded_at),
        ];
    }
}
