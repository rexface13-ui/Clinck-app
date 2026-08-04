<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How much of an invoice the patient's money has actually covered.
 *
 * Written together with `status` by PaymentService::refreshPatientInvoiceStatuses()
 * so the two can never disagree. Without it, "المتبقي" was computed from the
 * payments tagged to this one invoice while the status came from the patient's
 * whole account — so a bill settled by a shared check read "paid" and
 * "متبقي 160 ₪" side by side.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->decimal('settled_amount_ils', 12, 2)->default(0)->after('total_amount_ils');
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn('settled_amount_ils');
        });
    }
};
