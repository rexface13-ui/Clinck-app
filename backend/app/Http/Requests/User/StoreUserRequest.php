<?php

namespace App\Http\Requests\User;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
            'is_active' => ['sometimes', 'boolean'],
            'roles' => ['required', 'array', 'min:1'],
            'roles.*' => [Rule::exists('roles', 'name')],
            'branch_ids' => ['required', 'array', 'min:1'],
            'branch_ids.*' => [Rule::exists('branches', 'id')],
        ];
    }
}
