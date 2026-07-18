<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PlanItemSession extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'plan_item_id', 'session_number', 'status', 'appointment_id'];

    public function planItem(): BelongsTo
    {
        return $this->belongsTo(PlanItem::class);
    }

    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }
}
