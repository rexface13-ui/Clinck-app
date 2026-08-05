<?php

namespace App\Http\Requests\Note;

use App\Support\Dental\FdiTeeth;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

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
            // Same FDI set the chart and sessions use — a range check let a
            // note be filed against a tooth number that isn't on any chart,
            // where nothing would ever show it again.
            'tooth_number' => ['nullable', 'integer', Rule::in(FdiTeeth::validNumbers())],
            'work_item_id' => ['nullable', 'integer', 'exists:work_items,id'],
            'work_item_tooth_step_id' => ['nullable', 'integer', 'exists:work_item_tooth_steps,id'],
            'is_important' => ['sometimes', 'boolean'],
        ];
    }
}
