<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->decimal('price_ils', 14, 2);
            $table->unsignedInteger('max_users')->nullable();
            $table->unsignedInteger('max_branches')->nullable();
            $table->unsignedInteger('max_patients')->nullable();
            $table->unsignedInteger('storage_mb')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plans');
    }
};
