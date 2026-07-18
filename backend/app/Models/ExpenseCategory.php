<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ExpenseCategory extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'name'];

    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class);
    }
}
