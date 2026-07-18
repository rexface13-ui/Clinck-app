<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('check_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('check_id')->constrained()->cascadeOnDelete();
            $table->enum('event_type', ['received', 'endorsed', 'bounced', 'cleared']);
            $table->foreignId('endorsed_to_supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->timestampTz('occurred_at');
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('check_events');
    }
};
