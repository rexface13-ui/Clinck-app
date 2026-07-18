<?php

namespace App\Http\Requests\Doctor;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateDoctorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $contractType = $this->input('contract_type', $this->route('doctor')->contract_type);

        return [
            'user_id' => ['nullable', Rule::exists('users', 'id')],
            'full_name' => ['sometimes', 'required', 'string', 'max:255'],
            'contract_type' => ['sometimes', 'required', Rule::in(['salary', 'salary_commission', 'commission', 'independent'])],
            'monthly_salary' => [
                Rule::requiredIf(in_array($contractType, ['salary', 'salary_commission'], true)),
                'nullable', 'numeric', 'min:0',
            ],
            'default_commission_percent' => [
                Rule::requiredIf(in_array($contractType, ['salary_commission', 'commission', 'independent'], true)),
                'nullable', 'numeric', 'min:0', 'max:100',
            ],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if (! $this->has('contract_type')) {
            return;
        }

        $this->merge([
            'commission_direction' => match ($this->input('contract_type')) {
                'independent' => 'clinic_receives',
                'salary_commission', 'commission' => 'clinic_pays',
                default => null,
            },
        ]);
    }
}
