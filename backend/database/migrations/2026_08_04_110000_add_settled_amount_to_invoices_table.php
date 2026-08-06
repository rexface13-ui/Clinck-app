<?php

use App\Services\PaymentService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
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

        $this->backfill();
    }

    /**
     * Adding the column without filling it is not a smaller change, it's a
     * broken one: `paid_ils` reads straight off this column, so every invoice
     * in the clinic would show "مدفوعة" next to "المدفوع 0.00 ₪" until
     * something backfilled it. Populating a column you just created is part of
     * creating it — `status` is left exactly as the old code left it, so this
     * stays a schema change and not a data repair.
     *
     * Public so a test can exercise it against a database where the column
     * already exists, which is the only way to check the upgrade path.
     */
    public function backfill(): void
    {
        $service = app(PaymentService::class);

        foreach (DB::table('patients')->distinct()->pluck('clinic_id') as $clinicId) {
            CurrentClinic::set($clinicId);

            DB::table('patients')
                ->where('clinic_id', $clinicId)
                ->orderBy('id')
                ->pluck('id')
                ->each(fn ($patientId) => $service->refreshPatientInvoiceStatuses($patientId, writeStatus: false));
        }
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropColumn('settled_amount_ils');
        });
    }
};
