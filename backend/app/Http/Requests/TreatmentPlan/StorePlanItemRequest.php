<?php

namespace App\Http\Requests\TreatmentPlan;

use App\Support\Dental\FdiTeeth;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePlanItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'service_id' => ['required', Rule::exists('services', 'id')],
            'tooth_number' => ['nullable', 'integer', Rule::in(FdiTeeth::validNumbers())],
            'surfaces' => ['nullable', 'string', 'regex:/^[MDOIBL]+$/'],
            'unit_price' => ['required', 'numeric', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'sessions_count' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
