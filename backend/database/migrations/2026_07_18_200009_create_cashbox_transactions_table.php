<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cashbox_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('cashbox_id')->constrained()->cascadeOnDelete();
            $table->enum('type', ['payment_in', 'expense_out', 'income_in', 'check_in', 'check_out', 'adjustment']);
            $table->string('reference_type');
            $table->unsignedBigInteger('reference_id');
            $table->decimal('amount', 14, 2);
            $table->decimal('balance_after', 14, 2);
            $table->timestampTz('occurred_at');
            $table->timestamps();
            $table->index(['cashbox_id', 'occurred_at']);
            $table->index(['reference_type', 'reference_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cashbox_transactions');
    }
};
