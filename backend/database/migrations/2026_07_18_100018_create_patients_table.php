<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('patients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $table->string('code');
            $table->string('full_name');
            $table->date('birth_date')->nullable();
            $table->enum('gender', ['male', 'female']);
            $table->boolean('is_child')->default(false);
            $table->string('phone')->nullable();
            $table->string('guardian_name')->nullable();
            $table->string('guardian_phone')->nullable();
            $table->jsonb('medical_alerts')->nullable();
            $table->timestamps();
            $table->unique(['clinic_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('patients');
    }
};
