<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class PlanItemSession extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'plan_item_id', 'session_number', 'status', 'appointment_id', 'note', 'tooth_numbers'];

    protected function casts(): array
    {
        return ['tooth_numbers' => 'array'];
    }

    public function planItem(): BelongsTo
    {
        return $this->belongsTo(PlanItem::class);
    }

    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }

    public function invoiceLine(): HasOne
    {
        return $this->hasOne(InvoiceLine::class);
    }
}
