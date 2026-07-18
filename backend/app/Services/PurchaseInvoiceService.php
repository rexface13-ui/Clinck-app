<?php

namespace App\Services;

use App\Models\ItemLot;
use App\Models\ItemPriceHistory;
use App\Models\ItemSupplierPrice;
use App\Models\PurchaseInvoice;
use App\Models\StockMovement;
use App\Models\SupplierTransaction;
use Illuminate\Support\Facades\DB;

class PurchaseInvoiceService
{
    /**
     * Confirming a draft purchase invoice moves stock, updates price
     * memory, and posts one supplier_transaction for the whole invoice —
     * all in one transaction. Phase 3 never auto-consumes stock; a
     * purchase only ever adds.
     */
    public function confirm(PurchaseInvoice $invoice): PurchaseInvoice
    {
        abort_if($invoice->status !== 'draft', 422, 'الفاتورة مؤكدة مسبقاً.');
        abort_if($invoice->lines()->count() === 0, 422, 'أضف بند واحد على الأقل قبل التأكيد.');

        return DB::transaction(function () use ($invoice) {
            $invoice->load('lines.item');

            foreach ($invoice->lines as $line) {
                $itemLotId = null;

                if ($line->item->type === 'tracked') {
                    $lot = ItemLot::create([
                        'clinic_id' => $invoice->clinic_id,
                        'item_id' => $line->item_id,
                        'lot_number' => $line->lot_number,
                        'expiry_date' => $line->expiry_date,
                        'quantity_remaining' => $line->quantity,
                    ]);
                    $itemLotId = $lot->id;
                    $line->update(['item_lot_id' => $itemLotId]);
                }

                StockMovement::create([
                    'clinic_id' => $invoice->clinic_id,
                    'branch_id' => $invoice->branch_id,
                    'item_id' => $line->item_id,
                    'item_lot_id' => $itemLotId,
                    'type' => 'purchase_in',
                    'quantity' => $line->quantity,
                    'reference_type' => 'purchase_invoice',
                    'reference_id' => $invoice->id,
                    'occurred_at' => now(),
                ]);

                ItemSupplierPrice::updateOrCreate(
                    ['item_id' => $line->item_id, 'supplier_id' => $invoice->supplier_id],
                    ['clinic_id' => $invoice->clinic_id, 'last_price' => $line->unit_price, 'currency' => $line->currency],
                );

                ItemPriceHistory::create([
                    'clinic_id' => $invoice->clinic_id,
                    'item_id' => $line->item_id,
                    'supplier_id' => $invoice->supplier_id,
                    'price' => $line->unit_price,
                    'currency' => $line->currency,
                    'purchase_invoice_id' => $invoice->id,
                    'recorded_at' => now(),
                ]);
            }

            SupplierTransaction::create([
                'clinic_id' => $invoice->clinic_id,
                'supplier_id' => $invoice->supplier_id,
                'type' => 'purchase',
                'reference_type' => 'purchase_invoice',
                'reference_id' => $invoice->id,
                'amount_ils' => $invoice->total_amount_ils,
                'occurred_at' => now(),
            ]);

            $invoice->update(['status' => 'confirmed']);

            return $invoice->fresh(['lines.item', 'lines.itemLot', 'supplier', 'branch']);
        });
    }
}
