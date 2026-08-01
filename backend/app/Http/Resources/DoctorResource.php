<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DoctorResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'full_name' => $this->full_name,
            'contract_type' => $this->contract_type,
            'commission_direction' => $this->commission_direction,
            'default_commission_percent' => $this->default_commission_percent,
            'monthly_salary' => $this->monthly_salary,
            'is_active' => $this->is_active,
            'telegram_linked' => $this->relationLoaded('telegramLink') ? $this->telegramLink !== null : false,
            'availability' => DoctorAvailabilityResource::collection($this->whenLoaded('availability')),
            'service_commissions' => $this->whenLoaded('serviceCommissions', fn () => $this->serviceCommissions->map(fn ($c) => [
                'id' => $c->id,
                'service_id' => $c->service_id,
                'service_name' => $c->service->name,
                'commission_percent' => $c->commission_percent,
            ])),
        ];
    }
}
