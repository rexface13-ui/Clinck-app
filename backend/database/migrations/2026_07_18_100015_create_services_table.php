<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('services', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('service_category_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->decimal('default_price', 14, 2);
            $table->char('default_currency', 3)->default('ILS');
            $table->unsignedInteger('default_sessions')->default(1);
            $table->unsignedInteger('default_interval_days')->nullable();
            $table->decimal('default_commission_percent', 5, 2)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('services');
    }
};
