<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ToothState extends Model
{
    use BelongsToClinic;

    public $timestamps = false;

    protected $fillable = ['clinic_id', 'patient_id', 'tooth_number', 'status'];

    protected function casts(): array
    {
        return ['updated_at' => 'datetime'];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }
}
