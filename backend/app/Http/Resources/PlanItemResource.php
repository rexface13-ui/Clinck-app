<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PlanItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'service_id' => $this->service_id,
            'service_name' => $this->whenLoaded('service', fn () => $this->service?->name),
            'tooth_number' => $this->tooth_number,
            'surfaces' => $this->surfaces,
            'unit_price' => $this->unit_price,
            'currency' => $this->currency,
            'sessions_count' => $this->sessions_count,
            'interval_days' => $this->interval_days,
            'sessions' => $this->whenLoaded('sessions', fn () => $this->sessions->map(fn ($s) => [
                'id' => $s->id,
                'session_number' => $s->session_number,
                'status' => $s->status,
                'appointment_id' => $s->appointment_id,
            ])),
        ];
    }
}
