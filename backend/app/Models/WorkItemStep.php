<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WorkItemStep extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'work_item_id', 'service_step_id', 'title', 'price', 'sort_order'];

    protected function casts(): array
    {
        return ['price' => 'decimal:2'];
    }

    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    public function serviceStep(): BelongsTo
    {
        return $this->belongsTo(ServiceStep::class);
    }

    public function toothSteps(): HasMany
    {
        // Without an explicit order, Postgres doesn't guarantee row order is
        // stable across reloads — teeth would visibly shuffle position every
        // time a checkbox was toggled and the list refetched. Ordering by id
        // keeps each tooth pinned to the position it was first added in.
        return $this->hasMany(WorkItemToothStep::class)->orderBy('id');
    }
}
