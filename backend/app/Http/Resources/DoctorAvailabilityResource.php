<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DoctorAvailabilityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'weekday' => (int) $this->weekday,
            'start_time' => substr($this->start_time, 0, 5),
            'end_time' => substr($this->end_time, 0, 5),
        ];
    }
}
