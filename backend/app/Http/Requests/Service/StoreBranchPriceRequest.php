<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreBranchPriceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'branch_id' => ['required', Rule::exists('branches', 'id')],
            'price' => ['nullable', 'numeric', 'min:0'],
            'surcharge' => ['sometimes', 'numeric', 'min:0'],
        ];
    }
}
