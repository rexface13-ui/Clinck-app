<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('doctor_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained()->cascadeOnDelete();
            $table->foreignId('tooth_finding_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('type', ['commission', 'salary', 'settlement']);
            $table->decimal('amount_ils', 14, 2);
            $table->date('period_month');
            $table->timestampTz('settled_at')->nullable();
            $table->timestamps();
            $table->index(['doctor_id', 'period_month']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('doctor_transactions');
    }
};
