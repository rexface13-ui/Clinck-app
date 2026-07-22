<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('checks', function (Blueprint $table) {
            // Nullable — only set for outgoing checks issued to pay a purchase
            // invoice, so an invoice edit/delete can find and cancel "its"
            // check specifically (only while still in_wallet — see
            // PurchaseInvoiceController).
            $table->foreignId('purchase_invoice_id')->nullable()->after('id')->constrained()->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('checks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('purchase_invoice_id');
        });
    }
};
