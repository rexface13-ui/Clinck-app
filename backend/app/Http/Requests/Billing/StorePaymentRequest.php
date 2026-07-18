<?php

namespace App\Http\Requests\Billing;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePaymentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('billing.manage');
    }

    public function rules(): array
    {
        return [
            'invoice_id' => ['nullable', Rule::exists('invoices', 'id')],
            'cashbox_id' => ['required', Rule::exists('cashboxes', 'id')],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'currency' => ['required', 'string', 'size:3'],
            'exchange_rate' => ['required', 'numeric', 'min:0.000001'],
            'method' => ['required', Rule::in(['cash', 'card', 'transfer', 'check'])],
        ];
    }
}
