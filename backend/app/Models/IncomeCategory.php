<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class IncomeCategory extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'name'];

    public function incomes(): HasMany
    {
        return $this->hasMany(Income::class);
    }
}
