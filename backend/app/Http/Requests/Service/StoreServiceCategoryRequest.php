<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;

class StoreServiceCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('services.manage');
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
        ];
    }
}
