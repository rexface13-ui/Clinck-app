<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ToothStateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'tooth_number' => (int) $this->tooth_number,
            'status' => $this->status,
        ];
    }
}
