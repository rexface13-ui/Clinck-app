<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DoctorAvailability extends Model
{
    use BelongsToClinic;

    protected $table = 'doctor_availability';

    protected $fillable = ['clinic_id', 'doctor_id', 'branch_id', 'weekday', 'start_time', 'end_time'];

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
