<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('appointments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('doctor_id')->constrained()->cascadeOnDelete();
            $table->timestampTz('starts_at');
            $table->timestampTz('ends_at');
            $table->enum('status', ['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'])->default('scheduled');
            $table->enum('created_via', ['web', 'bot'])->default('web');
            $table->timestamps();
            $table->index(['doctor_id', 'starts_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('appointments');
    }
};
