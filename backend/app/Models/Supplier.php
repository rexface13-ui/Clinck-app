<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Supplier extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'name', 'phone', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(SupplierTransaction::class);
    }

    public function purchaseInvoices(): HasMany
    {
        return $this->hasMany(PurchaseInvoice::class);
    }
}
