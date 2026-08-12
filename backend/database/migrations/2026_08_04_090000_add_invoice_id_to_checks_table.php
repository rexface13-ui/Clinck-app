<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Lets an incoming patient check be applied to a specific invoice.
 *
 * Without it, a check settled the patient's overall balance but no invoice
 * ever learned it had been paid — so a patient who owed nothing still had
 * invoices reading "غير مدفوعة" forever, and every report built on the
 * payments table silently missed every shekel collected by check.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('checks', function (Blueprint $table) {
            $table->foreignId('invoice_id')->nullable()->after('purchase_invoice_id')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('checks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('invoice_id');
        });
    }
};
