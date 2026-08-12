<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A received check can now be endorsed straight to a patient (e.g. handing
 * one patient's check over as a refund to another), not just to a supplier —
 * mirrors endorsed_to_supplier_id.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('check_events', function (Blueprint $table) {
            $table->foreignId('endorsed_to_patient_id')->nullable()->after('endorsed_to_supplier_id')->constrained('patients')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('check_events', function (Blueprint $table) {
            $table->dropConstrainedForeignId('endorsed_to_patient_id');
        });
    }
};
