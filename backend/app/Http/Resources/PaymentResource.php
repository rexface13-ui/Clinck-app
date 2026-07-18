<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PaymentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'invoice_id' => $this->invoice_id,
            'cashbox_id' => $this->cashbox_id,
            'amount' => $this->amount,
            'currency' => $this->currency,
            'exchange_rate' => $this->exchange_rate,
            'amount_ils' => $this->amount_ils,
            'method' => $this->method,
            'paid_at' => display_datetime($this->paid_at),
        ];
    }
}
