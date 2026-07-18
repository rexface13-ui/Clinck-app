<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('treatment_plan_id')->nullable()->constrained()->nullOnDelete();
            $table->string('invoice_number');
            $table->enum('status', ['unpaid', 'partial', 'paid', 'void'])->default('unpaid');
            $table->decimal('total_amount_ils', 14, 2);
            $table->timestampTz('issued_at');
            $table->timestamps();
            $table->unique(['clinic_id', 'invoice_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoices');
    }
};
