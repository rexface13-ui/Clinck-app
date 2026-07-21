<?php

namespace App\Http\Requests\Dental;

use App\Support\Dental\FdiTeeth;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreToothFindingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'tooth_number' => ['required', 'integer', Rule::in(FdiTeeth::validNumbers())],
            'surfaces' => ['nullable', 'string', 'regex:/^[MDOIBL]+$/'],
            'finding_type' => ['required', 'string', 'max:100'],
            'status' => ['required', Rule::in(['planned', 'in_progress', 'done'])],
            'marks_missing' => ['sometimes', 'boolean'],
            'performed_externally' => ['sometimes', 'boolean'],
            'plan_item_session_id' => ['nullable', Rule::exists('plan_item_sessions', 'id')],
            'service_id' => ['nullable', Rule::exists('services', 'id')],
            'doctor_id' => ['nullable', Rule::exists('doctors', 'id')],
            'note' => ['nullable', 'string'],
            'recorded_at' => ['nullable', 'date'],
        ];
    }
}
