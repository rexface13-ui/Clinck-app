<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branch_service_prices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignId('service_id')->constrained()->cascadeOnDelete();
            $table->decimal('price', 14, 2)->nullable();
            $table->decimal('surcharge', 14, 2)->default(0);
            $table->timestamps();
            $table->unique(['branch_id', 'service_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_service_prices');
    }
};
