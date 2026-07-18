<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('doctors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('full_name');
            $table->enum('contract_type', ['salary', 'salary_commission', 'commission', 'independent']);
            $table->enum('commission_direction', ['clinic_pays', 'clinic_receives'])->nullable();
            $table->decimal('default_commission_percent', 5, 2)->nullable();
            $table->decimal('monthly_salary', 14, 2)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('doctors');
    }
};
