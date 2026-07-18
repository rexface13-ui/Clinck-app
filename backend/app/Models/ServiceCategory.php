<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ServiceCategory extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'name', 'sort_order'];

    public function services(): HasMany
    {
        return $this->hasMany(Service::class);
    }
}
