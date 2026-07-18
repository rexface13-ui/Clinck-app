<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('item_supplier_prices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('supplier_id')->constrained()->cascadeOnDelete();
            $table->decimal('last_price', 14, 2);
            $table->char('currency', 3);
            $table->timestamps();
            $table->unique(['item_id', 'supplier_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('item_supplier_prices');
    }
};
