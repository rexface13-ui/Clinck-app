<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('item_lots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->string('lot_number')->nullable();
            $table->date('expiry_date')->nullable();
            $table->decimal('quantity_remaining', 14, 3);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('item_lots');
    }
};
