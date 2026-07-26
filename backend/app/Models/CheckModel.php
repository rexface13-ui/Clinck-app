<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class CheckModel extends Model
{
    use BelongsToClinic;

    protected $table = 'checks';

    protected $fillable = [
        'clinic_id', 'direction', 'party_type', 'party_id', 'check_number',
        'bank_name', 'amount', 'currency', 'due_date', 'status', 'image_path',
        'image_requested_at', 'received_at', 'purchase_invoice_id',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'due_date' => 'date',
            'image_requested_at' => 'datetime',
            'received_at' => 'datetime',
        ];
    }

    public function party(): MorphTo
    {
        return $this->morphTo();
    }

    public function events(): HasMany
    {
        return $this->hasMany(CheckEvent::class, 'check_id');
    }
}
