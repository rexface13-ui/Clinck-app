<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('medications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            // Free text on purpose — "حبوب/شراب/مرهم/..." is just a label
            // for display and printing, not something else keys off of.
            $table->string('form')->nullable();
            $table->text('usage_instructions')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('medication_allergy', function (Blueprint $table) {
            $table->id();
            $table->foreignId('medication_id')->constrained()->cascadeOnDelete();
            $table->foreignId('allergy_id')->constrained()->cascadeOnDelete();
            $table->unique(['medication_id', 'allergy_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('medication_allergy');
        Schema::dropIfExists('medications');
    }
};
