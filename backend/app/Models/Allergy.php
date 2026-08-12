<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Allergy extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'name'];

    public function medications(): BelongsToMany
    {
        return $this->belongsToMany(Medication::class, 'medication_allergy');
    }
}
