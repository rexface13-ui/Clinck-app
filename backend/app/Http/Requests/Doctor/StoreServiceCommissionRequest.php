<?php

namespace App\Http\Requests\Doctor;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreServiceCommissionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'service_id' => ['required', Rule::exists('services', 'id')],
            'commission_percent' => ['required', 'numeric', 'min:0', 'max:100'],
        ];
    }
}
