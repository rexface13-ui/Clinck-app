<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DoctorServiceCommission extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'doctor_id', 'service_id', 'commission_percent'];

    protected function casts(): array
    {
        return ['commission_percent' => 'decimal:2'];
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }
}
