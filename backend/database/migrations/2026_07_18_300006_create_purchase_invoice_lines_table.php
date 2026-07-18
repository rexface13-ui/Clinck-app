<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_invoice_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('purchase_invoice_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->decimal('quantity', 14, 3);
            $table->decimal('unit_price', 14, 2);
            $table->char('currency', 3);
            $table->decimal('amount_ils', 14, 2);
            $table->foreignId('item_lot_id')->nullable()->constrained()->nullOnDelete();
            $table->string('lot_number')->nullable();
            $table->date('expiry_date')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_invoice_lines');
    }
};
