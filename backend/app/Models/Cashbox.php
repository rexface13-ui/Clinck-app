<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Cashbox extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'branch_id', 'currency', 'name', 'balance'];

    protected function casts(): array
    {
        return ['balance' => 'decimal:2'];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(CashboxTransaction::class);
    }
}
