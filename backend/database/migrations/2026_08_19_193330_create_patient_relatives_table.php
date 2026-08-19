<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per link, stored once regardless of direction — the label
 * describes the relationship between the two patients, not one patient's
 * relationship to the other, so there's nothing to duplicate by storing it
 * twice with the ends swapped.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('patient_relatives', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('related_patient_id')->constrained('patients')->cascadeOnDelete();
            $table->string('label');
            $table->timestamps();
            $table->unique(['patient_id', 'related_patient_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('patient_relatives');
    }
};
