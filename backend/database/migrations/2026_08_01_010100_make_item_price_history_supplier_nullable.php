<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Lets a price-history row record a plain default-price edit on the item
 * itself (no supplier, no purchase invoice involved) alongside the existing
 * per-supplier purchase-linked rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE item_price_history DROP CONSTRAINT item_price_history_supplier_id_foreign');
        DB::statement('ALTER TABLE item_price_history ALTER COLUMN supplier_id DROP NOT NULL');
        DB::statement('ALTER TABLE item_price_history ADD CONSTRAINT item_price_history_supplier_id_foreign FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE');

        DB::statement('ALTER TABLE item_price_history DROP CONSTRAINT item_price_history_purchase_invoice_id_foreign');
        DB::statement('ALTER TABLE item_price_history ALTER COLUMN purchase_invoice_id DROP NOT NULL');
        DB::statement('ALTER TABLE item_price_history ADD CONSTRAINT item_price_history_purchase_invoice_id_foreign FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices (id) ON DELETE CASCADE');
    }

    public function down(): void
    {
        DB::statement('DELETE FROM item_price_history WHERE supplier_id IS NULL OR purchase_invoice_id IS NULL');

        DB::statement('ALTER TABLE item_price_history DROP CONSTRAINT item_price_history_supplier_id_foreign');
        DB::statement('ALTER TABLE item_price_history ALTER COLUMN supplier_id SET NOT NULL');
        DB::statement('ALTER TABLE item_price_history ADD CONSTRAINT item_price_history_supplier_id_foreign FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE');

        DB::statement('ALTER TABLE item_price_history DROP CONSTRAINT item_price_history_purchase_invoice_id_foreign');
        DB::statement('ALTER TABLE item_price_history ALTER COLUMN purchase_invoice_id SET NOT NULL');
        DB::statement('ALTER TABLE item_price_history ADD CONSTRAINT item_price_history_purchase_invoice_id_foreign FOREIGN KEY (purchase_invoice_id) REFERENCES purchase_invoices (id) ON DELETE CASCADE');
    }
};
