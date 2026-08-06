<?php

use App\Models\DoctorTransaction;
use App\Models\Invoice;
use App\Models\Patient;
use App\Services\PaymentService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Repairs the records the recent billing fixes left behind.
 *
 * The code no longer produces either of these problems, but existing clinics
 * still carry the ones already written — and neither can be reasoned about
 * from the screens, so they get corrected here rather than by hand.
 *
 * 1. Commissions stranded by cancelled work. Cancelling used to delete the
 *    tooth-finding while the commission row only had its link nulled, leaving
 *    the doctor owed for treatment that never happened, with no trace of which
 *    patient or tooth it came from. Each is cancelled out by a reversing entry
 *    that says why, exactly as WorkItemService does now.
 *
 * 2. Invoices reading "غير مدفوعة" that were actually paid. Status used to be
 *    judged only on money tagged to that one invoice, so a check covering four
 *    visits — or any cash taken without picking an invoice — settled the
 *    patient's balance while every invoice still showed as owing. Recomputing
 *    with the new allocation puts them right.
 *
 * Deliberately touches no money: no payment, check, charge or invoice total is
 * altered. It reverses a commission that shouldn't stand and recomputes a
 * status field. Idempotent — running it twice changes nothing the second time.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::transaction(function () {
            $this->reverseStrandedCommissions();
            $this->recomputeInvoiceStatuses();
        });
    }

    /**
     * Nothing to undo: reversing a commission that was never owed and
     * recomputing a derived status aren't states worth restoring.
     */
    public function down(): void
    {
        //
    }

    private function reverseStrandedCommissions(): void
    {
        // A positive commission with no finding left and no note is one the old
        // cancel path abandoned. Both the reversal and the original get a note,
        // so a second run finds nothing left to do rather than reversing the
        // same commission twice.
        $stranded = DoctorTransaction::withoutGlobalScopes()
            ->where('type', 'commission')
            ->whereNull('tooth_finding_id')
            ->whereNull('notes')
            ->where('amount_ils', '>', 0)
            ->get();

        foreach ($stranded as $commission) {
            DoctorTransaction::withoutGlobalScopes()->create([
                'clinic_id' => $commission->clinic_id,
                'doctor_id' => $commission->doctor_id,
                'tooth_finding_id' => null,
                'type' => 'commission',
                'amount_ils' => -(float) $commission->amount_ils,
                'period_month' => $commission->period_month,
                'notes' => 'عكس عمولة — الشغل انلغى (تصحيح تلقائي لسجلات قديمة)',
            ]);

            $commission->update(['notes' => 'عمولة على شغل انلغى — انعكست بقيد مقابل']);
        }

        if ($stranded->isNotEmpty()) {
            info("[repair] reversed {$stranded->count()} stranded doctor commission(s).");
        }
    }

    private function recomputeInvoiceStatuses(): void
    {
        $service = app(PaymentService::class);
        $before = Invoice::withoutGlobalScopes()->pluck('status', 'id');

        // Scoped models are filtered to the current clinic, so walk the
        // clinics present in the data rather than assuming the local one.
        foreach (DB::table('patients')->distinct()->pluck('clinic_id') as $clinicId) {
            \App\Support\Tenancy\CurrentClinic::set((int) $clinicId);

            Patient::query()->select('id')->chunkById(200, function ($patients) use ($service) {
                foreach ($patients as $patient) {
                    $service->refreshPatientInvoiceStatuses($patient->id);
                }
            });
        }

        $changed = Invoice::withoutGlobalScopes()
            ->pluck('status', 'id')
            ->filter(fn ($status, $id) => ($before[$id] ?? null) !== $status)
            ->count();

        if ($changed > 0) {
            info("[repair] corrected the paid status of {$changed} invoice(s).");
        }
    }
};
