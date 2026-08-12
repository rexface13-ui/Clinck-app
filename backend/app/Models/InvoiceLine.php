<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InvoiceLine extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'invoice_id', 'work_item_tooth_step_id', 'description',
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

    public function workItemToothStep(): BelongsTo
    {
        return $this->belongsTo(WorkItemToothStep::class);
    }
}
