<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('invoice_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('cashbox_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 14, 2);
            $table->char('currency', 3);
            $table->decimal('exchange_rate', 14, 6)->default(1);
            $table->decimal('amount_ils', 14, 2);
            $table->enum('method', ['cash', 'card', 'transfer', 'check']);
            $table->timestampTz('paid_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
