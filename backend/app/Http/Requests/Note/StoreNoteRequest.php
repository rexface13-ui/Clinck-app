<?php

namespace App\Http\Requests\Note;

use Illuminate\Foundation\Http\FormRequest;

class StoreNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'body' => ['required', 'string'],
            'tooth_number' => ['nullable', 'integer', 'min:1', 'max:85'],
            'work_item_id' => ['nullable', 'integer', 'exists:work_items,id'],
            'is_important' => ['sometimes', 'boolean'],
        ];
    }
}
