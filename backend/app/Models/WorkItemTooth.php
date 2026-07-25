<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WorkItemTooth extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'work_item_id', 'tooth_number'];

    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }
}
