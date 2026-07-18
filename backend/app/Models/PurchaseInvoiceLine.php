<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PurchaseInvoiceLine extends Model
{
    use BelongsToClinic;

    protected $fillable = [
        'clinic_id', 'purchase_invoice_id', 'item_id', 'quantity', 'unit_price',
        'currency', 'amount_ils', 'item_lot_id', 'lot_number', 'expiry_date',
    ];

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'unit_price' => 'decimal:2',
            'amount_ils' => 'decimal:2',
            'expiry_date' => 'date',
        ];
    }

    public function purchaseInvoice(): BelongsTo
    {
        return $this->belongsTo(PurchaseInvoice::class);
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }

    public function itemLot(): BelongsTo
    {
        return $this->belongsTo(ItemLot::class);
    }
}
