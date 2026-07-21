<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InvoiceLine extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'invoice_id', 'plan_item_id', 'plan_item_session_id', 'description',
        'amount', 'currency', 'exchange_rate', 'amount_ils',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'exchange_rate' => 'decimal:6',
            'amount_ils' => 'decimal:2',
        ];
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function planItem(): BelongsTo
    {
        return $this->belongsTo(PlanItem::class);
    }

    public function planItemSession(): BelongsTo
    {
        return $this->belongsTo(PlanItemSession::class);
    }
}
