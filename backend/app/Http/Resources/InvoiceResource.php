<?php

namespace App\Http\Resources;

use App\Models\WorkItemToothStep;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InvoiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'patient_id' => $this->patient_id,
            'invoice_number' => $this->invoice_number,
            'status' => $this->status,
            'total_amount_ils' => $this->total_amount_ils,
            // What the patient's money has actually covered on this bill,
            // written alongside `status` so the two always agree. Summing only
            // the payments tagged to this invoice made a bill settled by a
            // shared check show "paid" and "متبقي 160 ₪" at the same time.
            'paid_ils' => (float) $this->settled_amount_ils,
            'issued_at' => display_date($this->issued_at),
            'lines' => $this->whenLoaded('lines', fn () => $this->lines->map(function ($l) {
                $workItem = $l->workItemToothStep?->workItem;

                return [
                    'id' => $l->id,
                    'description' => $l->description,
                    'amount' => $l->amount,
                    'currency' => $l->currency,
                    'amount_ils' => $l->amount_ils,
                    // Which session this charge came out of, so "شو بتشمل
                    // هالفاتورة" is answerable from the invoice itself rather
                    // than by cross-referencing the work-planning tab.
                    'service_name' => $workItem?->service?->name,
                    'step_title' => $l->workItemToothStep?->step?->title,
                    'doctor_name' => $workItem?->doctor?->full_name,
                    // A flat-fee line covers several teeth at once, so list
                    // every tooth tagged to this line, not just one.
                    'tooth_numbers' => $l->relationLoaded('workItemToothStep') && $l->workItemToothStep
                        ? WorkItemToothStep::where('invoice_line_id', $l->id)
                            ->pluck('tooth_number')
                            ->map(fn ($n) => (int) $n)
                            ->values()
                            ->all()
                        : [],
                ];
            })),
        ];
    }
}
