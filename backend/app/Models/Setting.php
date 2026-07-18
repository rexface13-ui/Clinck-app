<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'key', 'value'];

    protected function casts(): array
    {
        return ['value' => 'array'];
    }
}
