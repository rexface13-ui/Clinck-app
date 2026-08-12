<?php

namespace App\Http\Requests\Patient;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePatientRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'branch_id' => ['required', Rule::exists('branches', 'id')],
            'full_name' => ['required', 'string', 'max:255'],
            'birth_date' => ['nullable', 'date', 'before_or_equal:today'],
            'age' => ['nullable', 'integer', 'min:0', 'max:120'],
            'gender' => ['required', Rule::in(['male', 'female'])],
            'is_child' => ['sometimes', 'boolean'],
            'phone' => ['nullable', 'string', 'max:50'],
            'guardian_name' => ['nullable', 'required_with:guardian_phone', 'string', 'max:255'],
            'guardian_phone' => ['nullable', 'string', 'max:50'],
            'medical_alerts' => ['nullable', 'array'],
            'medical_alerts.*' => ['string'],
            'medical_notes' => ['nullable', 'string'],
        ];
    }
}
