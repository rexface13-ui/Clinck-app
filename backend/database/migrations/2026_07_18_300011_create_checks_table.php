<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('checks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->enum('direction', ['incoming', 'outgoing']);
            $table->string('party_type');
            $table->unsignedBigInteger('party_id');
            $table->string('check_number');
            $table->string('bank_name')->nullable();
            $table->decimal('amount', 14, 2);
            $table->char('currency', 3);
            $table->date('due_date');
            $table->enum('status', ['in_wallet', 'endorsed', 'bounced', 'cleared'])->default('in_wallet');
            $table->timestampTz('image_requested_at')->nullable();
            $table->timestampTz('received_at');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('checks');
    }
};
