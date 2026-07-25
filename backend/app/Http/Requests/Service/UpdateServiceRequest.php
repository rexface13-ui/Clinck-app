<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateServiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'service_category_id' => ['sometimes', 'nullable', Rule::exists('service_categories', 'id')],
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'default_price' => ['sometimes', 'required', 'numeric', 'min:0'],
            'default_currency' => ['sometimes', 'string', 'size:3'],
            'default_sessions' => ['sometimes', 'integer', 'min:1'],
            'default_interval_days' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'default_commission_percent' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
            'marks_teeth_missing' => ['sometimes', 'boolean'],
            'price_per_tooth' => ['sometimes', 'boolean'],
        ];
    }
}
