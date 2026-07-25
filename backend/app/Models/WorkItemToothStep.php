<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class WorkItemToothStep extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'work_item_id', 'tooth_number', 'work_item_step_id', 'field_values', 'completed_at', 'invoice_line_id'];

    protected function casts(): array
    {
        return ['field_values' => 'array', 'completed_at' => 'datetime'];
    }

    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    public function step(): BelongsTo
    {
        return $this->belongsTo(WorkItemStep::class, 'work_item_step_id');
    }

    public function invoiceLine(): HasOne
    {
        return $this->hasOne(InvoiceLine::class);
    }

    public function toothFinding(): HasOne
    {
        return $this->hasOne(ToothFinding::class);
    }
}
