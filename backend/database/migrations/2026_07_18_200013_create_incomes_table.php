<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('incomes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('income_category_id')->constrained()->cascadeOnDelete();
            $table->foreignId('cashbox_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 14, 2);
            $table->char('currency', 3);
            $table->decimal('amount_ils', 14, 2);
            $table->string('description')->nullable();
            $table->timestampTz('received_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('incomes');
    }
};
