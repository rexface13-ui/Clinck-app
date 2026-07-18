<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tooth_states', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('tooth_number');
            $table->enum('status', ['present', 'missing'])->default('present');
            $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
            $table->unique(['patient_id', 'tooth_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tooth_states');
    }
};
