<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Medication extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'name', 'form', 'usage_instructions', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function allergies(): BelongsToMany
    {
        return $this->belongsToMany(Allergy::class, 'medication_allergy');
    }
}
