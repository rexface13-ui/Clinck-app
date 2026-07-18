<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CheckEvent extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'check_id', 'event_type', 'endorsed_to_supplier_id',
        'occurred_at', 'notes',
    ];

    protected function casts(): array
    {
        return ['occurred_at' => 'datetime'];
    }

    public function check(): BelongsTo
    {
        return $this->belongsTo(CheckModel::class, 'check_id');
    }

    public function endorsedToSupplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class, 'endorsed_to_supplier_id');
    }
}
