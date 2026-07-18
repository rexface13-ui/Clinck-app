<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Branch extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'name', 'is_main', 'address', 'phone', 'is_active'];

    protected function casts(): array
    {
        return [
            'is_main' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function clinic(): BelongsTo
    {
        return $this->belongsTo(Clinic::class);
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'user_branch');
    }

    public function patients(): HasMany
    {
        return $this->hasMany(Patient::class);
    }

    public function doctorAvailability(): HasMany
    {
        return $this->hasMany(DoctorAvailability::class);
    }

    public function appointments(): HasMany
    {
        return $this->hasMany(Appointment::class);
    }
}
