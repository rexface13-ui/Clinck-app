<?php

namespace App\Http\Requests\Attachment;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreAttachmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // `file` is the original single-upload field, kept so nothing that
            // already posts it breaks; `files[]` is the batch form.
            'file' => ['nullable', 'file', 'max:10240'],
            'files' => ['nullable', 'array', 'max:20'],
            'files.*' => ['file', 'max:10240'],
            'title' => ['nullable', 'string', 'max:255'],
            'titles' => ['nullable', 'array'],
            'titles.*' => ['nullable', 'string', 'max:255'],
            // Optional: push the image ones straight to this doctor's Telegram
            // once saved — same "don't make them dig through the app" idea as
            // a check's own photo notification.
            'notify_doctor_id' => ['nullable', 'integer', 'exists:doctors,id'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if (! $this->hasFile('file') && ! $this->hasFile('files')) {
                $validator->errors()->add('file', 'لازم تختار ملف واحد عالأقل.');
            }
        });
    }
}
