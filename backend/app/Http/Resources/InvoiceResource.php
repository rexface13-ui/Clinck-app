<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InvoiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'patient_id' => $this->patient_id,
            'treatment_plan_id' => $this->treatment_plan_id,
            'invoice_number' => $this->invoice_number,
            'status' => $this->status,
            'total_amount_ils' => $this->total_amount_ils,
            'paid_ils' => $this->whenLoaded('payments', fn () => $this->payments->sum('amount_ils')),
            'issued_at' => display_date($this->issued_at),
            'lines' => $this->whenLoaded('lines', fn () => $this->lines->map(fn ($l) => [
                'id' => $l->id,
                'description' => $l->description,
                'amount' => $l->amount,
                'currency' => $l->currency,
                'amount_ils' => $l->amount_ils,
            ])),
        ];
    }
}
