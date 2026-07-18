<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BranchServicePrice extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'branch_id', 'service_id', 'price', 'surcharge'];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'surcharge' => 'decimal:2',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }
}
