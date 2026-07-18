<?php

namespace App\Http\Requests\User;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $userId = $this->route('user')->id;

        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($userId)],
            'password' => ['sometimes', 'nullable', 'string', 'min:8'],
            'is_active' => ['sometimes', 'boolean'],
            'roles' => ['sometimes', 'array', 'min:1'],
            'roles.*' => [Rule::exists('roles', 'name')],
            'branch_ids' => ['sometimes', 'array', 'min:1'],
            'branch_ids.*' => [Rule::exists('branches', 'id')],
        ];
    }
}
