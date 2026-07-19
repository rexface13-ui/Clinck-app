<?php

namespace App\Http\Requests\TreatmentPlan;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTreatmentPlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'patient_id' => ['required', Rule::exists('patients', 'id')],
            'doctor_id' => ['nullable', Rule::exists('doctors', 'id')],
            'appointment_id' => ['nullable', Rule::exists('appointments', 'id')],
            'notes' => ['nullable', 'string'],
        ];
    }
}
