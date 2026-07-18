<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tooth_findings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('tooth_number');
            $table->string('surfaces')->nullable();
            $table->string('finding_type');
            $table->enum('status', ['planned', 'in_progress', 'done']);
            $table->foreignId('service_id')->nullable()->constrained('services')->nullOnDelete();
            $table->foreignId('doctor_id')->nullable()->constrained('doctors')->nullOnDelete();
            $table->text('note')->nullable();
            $table->timestampTz('recorded_at');
            $table->timestamps();
            $table->index(['patient_id', 'tooth_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tooth_findings');
    }
};
