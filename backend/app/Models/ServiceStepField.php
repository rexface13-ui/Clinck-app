<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ServiceStepField extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'service_step_id', 'label', 'sort_order'];

    public function step(): BelongsTo
    {
        return $this->belongsTo(ServiceStep::class, 'service_step_id');
    }
}
