<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cashboxes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $table->char('currency', 3);
            $table->string('name');
            $table->decimal('balance', 14, 2)->default(0);
            $table->timestamps();
            $table->unique(['branch_id', 'currency']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cashboxes');
    }
};
