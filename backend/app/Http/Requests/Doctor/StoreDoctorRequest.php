<?php

namespace App\Http\Requests\Doctor;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDoctorRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Field requirements depend on contract_type:
     * - salary: monthly_salary required
     * - salary_commission: monthly_salary + default_commission_percent required
     * - commission: default_commission_percent required
     * - independent: default_commission_percent required; commission_direction
     *   is always clinic_receives, forced server-side (not user input).
     */
    public function rules(): array
    {
        $contractType = $this->input('contract_type');

        return [
            'user_id' => ['nullable', Rule::exists('users', 'id')],
            'full_name' => ['required', 'string', 'max:255'],
            'contract_type' => ['required', Rule::in(['salary', 'salary_commission', 'commission', 'independent'])],
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
        // commission_direction is derived from contract_type, never a
        // user choice: independent doctors collect from patients and remit
        // to the clinic (clinic_receives); salaried/commissioned doctors
        // are paid by the clinic (clinic_pays); pure salary has no
        // commission flow at all.
        $this->merge([
            'commission_direction' => match ($this->input('contract_type')) {
                'independent' => 'clinic_receives',
                'salary_commission', 'commission' => 'clinic_pays',
                default => null,
            },
        ]);
    }
}
