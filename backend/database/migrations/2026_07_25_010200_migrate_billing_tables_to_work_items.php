<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->dropConstrainedForeignId('plan_item_id');
            $table->foreignId('work_item_tooth_step_id')->nullable()->constrained()->nullOnDelete();
        });

        Schema::table('tooth_findings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('plan_item_session_id');
            $table->foreignId('work_item_tooth_step_id')->nullable()->constrained()->nullOnDelete();
        });

        Schema::table('prescriptions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('plan_item_session_id');
        });

        Schema::table('invoices', function (Blueprint $table) {
            $table->dropConstrainedForeignId('treatment_plan_id');
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->foreignId('treatment_plan_id')->nullable()->constrained()->nullOnDelete();
        });

        Schema::table('prescriptions', function (Blueprint $table) {
            $table->foreignId('plan_item_session_id')->nullable()->constrained()->nullOnDelete();
        });

        Schema::table('tooth_findings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('work_item_tooth_step_id');
            $table->foreignId('plan_item_session_id')->nullable()->constrained()->nullOnDelete();
        });

        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->dropConstrainedForeignId('work_item_tooth_step_id');
            $table->foreignId('plan_item_id')->nullable()->constrained()->nullOnDelete();
        });
    }
};
