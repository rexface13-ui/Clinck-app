<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PatientResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'branch_id' => $this->branch_id,
            'full_name' => $this->full_name,
            'birth_date' => display_date($this->birth_date),
            'gender' => $this->gender,
            'is_child' => $this->is_child,
            'phone' => $this->phone,
            'guardian_name' => $this->guardian_name,
            'guardian_phone' => $this->guardian_phone,
            'medical_alerts' => $this->medical_alerts ?? [],
            'created_at' => display_date($this->created_at),
        ];
    }
}
