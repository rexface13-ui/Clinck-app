<?php

namespace App\Http\Requests\Patient;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePatientRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'branch_id' => ['sometimes', 'required', Rule::exists('branches', 'id')],
            'full_name' => ['sometimes', 'required', 'string', 'max:255'],
            'birth_date' => ['sometimes', 'nullable', 'date', 'before_or_equal:today'],
            'gender' => ['sometimes', 'required', Rule::in(['male', 'female'])],
            'is_child' => ['sometimes', 'boolean'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:50'],
            'guardian_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'guardian_phone' => ['sometimes', 'nullable', 'string', 'max:50'],
            'medical_alerts' => ['sometimes', 'nullable', 'array'],
            'medical_alerts.*' => ['string'],
        ];
    }
}
