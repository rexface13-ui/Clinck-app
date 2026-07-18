<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_item_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('plan_item_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('session_number');
            $table->enum('status', ['pending', 'scheduled', 'done', 'cancelled'])->default('pending');
            $table->foreignId('appointment_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_item_sessions');
    }
};
