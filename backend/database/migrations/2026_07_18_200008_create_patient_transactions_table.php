<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('patient_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->enum('type', ['charge', 'payment', 'refund', 'adjustment']);
            $table->string('reference_type');
            $table->unsignedBigInteger('reference_id');
            $table->decimal('amount', 14, 2);
            $table->char('currency', 3);
            $table->decimal('exchange_rate', 14, 6)->default(1);
            $table->decimal('amount_ils', 14, 2);
            $table->timestampTz('occurred_at');
            $table->timestamps();
            $table->index(['patient_id', 'occurred_at']);
            $table->index(['reference_type', 'reference_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('patient_transactions');
    }
};
