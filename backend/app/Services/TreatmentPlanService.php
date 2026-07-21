<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Cashbox;
use App\Models\DoctorTransaction;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\PatientTransaction;
use App\Models\PlanItem;
use App\Models\PlanItemSession;
use App\Models\ToothFinding;
use App\Models\TreatmentPlan;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class TreatmentPlanService
{
    public function __construct(protected PaymentService $paymentService)
    {
    }

    /**
     * Approving a plan only locks it in and schedules its sessions — it
     * does NOT charge anything. Nothing is owed until a session actually
     * happens; each session is billed individually via completeSession()
     * when the patient shows up and it's actually carried out (mirrors the
     * same-day "اجاني هلق" visit flow, just spread across future visits).
     */
    public function approve(TreatmentPlan $plan): TreatmentPlan
    {
        abort_if($plan->status !== 'draft', 422, 'الخطة معتمدة أو ملغاة مسبقاً.');

        $plan->loadMissing('items');
        abort_if($plan->items->isEmpty(), 422, 'لا يمكن اعتماد خطة بدون بنود.');

        DB::transaction(function () use ($plan) {
            foreach ($plan->items as $item) {
                for ($i = 1; $i <= $item->sessions_count; $i++) {
                    PlanItemSession::create([
                        'clinic_id' => $plan->clinic_id,
                        'plan_item_id' => $item->id,
                        'session_number' => $i,
                        'status' => 'pending',
                    ]);
                }
            }

            $plan->update(['status' => 'approved', 'approved_at' => now()]);
        });

        return $plan->fresh(['items.sessions']);
    }

    /**
     * Marks one session as actually done and bills exactly that session's
     * price — nothing more. Adds (or reuses) the plan's open invoice, logs
     * the charge on the patient's ledger, optionally records the tooth
     * finding + doctor commission (only once the item's last session is
     * done, since multi-session same-tooth items share one finding row),
     * and optionally collects payment immediately.
     */
    public function completeSession(
        PlanItemSession $session,
        float $price,
        ?int $payCashboxId = null,
        ?string $payMethod = null,
    ): PlanItemSession {
        $item = $session->planItem()->with('treatmentPlan', 'service')->first();
        $plan = $item->treatmentPlan;

        abort_if($plan->status !== 'approved', 422, 'الخطة لازم تكون معتمدة أولاً.');
        abort_if($session->status === 'done', 422, 'هالجلسة محسوبة مسبقاً.');
        abort_if($session->status === 'cancelled', 422, 'هالجلسة ملغاة.');

        return DB::transaction(function () use ($session, $item, $plan, $price, $payCashboxId, $payMethod) {
            $invoice = $plan->invoices()->where('status', '!=', 'void')->latest('id')->first();

            if (! $invoice) {
                $invoice = Invoice::create([
                    'clinic_id' => $plan->clinic_id,
                    'patient_id' => $plan->patient_id,
                    'treatment_plan_id' => $plan->id,
                    'invoice_number' => $this->nextInvoiceNumber($plan->clinic_id),
                    'status' => 'unpaid',
                    'total_amount_ils' => 0,
                    'issued_at' => now(),
                ]);
            }

            $sessionLabel = $item->sessions_count > 1 ? " — جلسة {$session->session_number}/{$item->sessions_count}" : '';

            InvoiceLine::create([
                'clinic_id' => $plan->clinic_id,
                'invoice_id' => $invoice->id,
                'plan_item_id' => $item->id,
                'plan_item_session_id' => $session->id,
                'description' => $item->service->name.($item->tooth_number ? " (سن {$item->tooth_number})" : '').$sessionLabel,
                'amount' => $price,
                'currency' => $item->currency,
                'exchange_rate' => 1,
                'amount_ils' => $price,
            ]);

            $invoice->update(['total_amount_ils' => $invoice->total_amount_ils + $price]);

            PatientTransaction::create([
                'clinic_id' => $plan->clinic_id,
                'patient_id' => $plan->patient_id,
                'type' => 'charge',
                'reference_type' => 'invoice',
                'reference_id' => $invoice->id,
                'amount' => $price,
                'currency' => 'ILS',
                'exchange_rate' => 1,
                'amount_ils' => $price,
                'occurred_at' => now(),
            ]);

            $session->update(['status' => 'done']);

            if ($item->tooth_number) {
                $doneCount = $item->sessions()->where('status', 'done')->count();
                $isLastSession = $doneCount >= $item->sessions_count;

                $finding = ToothFinding::updateOrCreate(
                    [
                        'patient_id' => $plan->patient_id,
                        'tooth_number' => $item->tooth_number,
                        'service_id' => $item->service_id,
                    ],
                    [
                        'clinic_id' => $item->clinic_id,
                        'finding_type' => $item->service->name,
                        'status' => $isLastSession ? 'done' : 'in_progress',
                        'doctor_id' => $plan->doctor_id,
                        'plan_item_session_id' => $session->id,
                        'recorded_at' => now(),
                    ],
                );

                if ($isLastSession) {
                    app(CommissionService::class)->computeForFinding($finding);
                }
            }

            if ($payCashboxId) {
                $cashbox = Cashbox::findOrFail($payCashboxId);
                $this->paymentService->collect(
                    patient: $plan->patient,
                    cashbox: $cashbox,
                    amount: $price,
                    currency: $cashbox->currency,
                    exchangeRate: 1,
                    method: $payMethod ?? 'cash',
                    invoice: $invoice,
                );
            } else {
                $this->paymentService->refreshInvoiceStatus($invoice->fresh());
            }

            return $session->fresh();
        });
    }

    /**
     * Cancelling an approved plan cancels every session that hasn't
     * happened yet (done sessions stay — they were real, billed visits)
     * and reverses whatever charges those cancelled sessions had already
     * posted (a session can be "done" and billed without being paid).
     */
    public function cancel(TreatmentPlan $plan): TreatmentPlan
    {
        abort_if($plan->status !== 'approved', 422, 'إلغاء الخطة ممكن فقط للخطط المعتمدة.');

        DB::transaction(function () use ($plan) {
            $plan->loadMissing('items.sessions');

            foreach ($plan->items as $item) {
                foreach ($item->sessions as $session) {
                    if ($session->status === 'cancelled') {
                        continue;
                    }
                    if ($session->status === 'done') {
                        continue; // already happened and billed — not undone by cancelling the rest of the plan
                    }

                    $this->cancelSession($session);
                }
            }

            $plan->update(['status' => 'cancelled']);
        });

        return $plan->fresh(['items.sessions']);
    }

    /**
     * Edits an already-completed (billed) session after the fact — a note
     * and/or a corrected price. The note is just stored. A price change
     * posts the delta as a signed 'adjustment' ledger entry (not a rewrite
     * of the original charge) so the patient's transaction history stays
     * an honest audit trail, and updates the invoice line/total in place.
     */
    public function updateSession(PlanItemSession $session, ?float $price, ?string $note): PlanItemSession
    {
        abort_if($session->status !== 'done', 422, 'التعديل ممكن بس للجلسات المحسوبة.');

        DB::transaction(function () use ($session, $price, $note) {
            if ($note !== null) {
                $session->update(['note' => $note]);
            }

            if ($price !== null) {
                $item = $session->planItem;
                $plan = $item->treatmentPlan;
                $line = InvoiceLine::where('plan_item_session_id', $session->id)->first();

                if ($line && round((float) $line->amount_ils, 2) !== round($price, 2)) {
                    $delta = round($price - (float) $line->amount_ils, 2);
                    $invoice = $line->invoice;

                    $line->update(['amount' => $price, 'amount_ils' => $price]);
                    $invoice->update(['total_amount_ils' => max(0, $invoice->total_amount_ils + $delta)]);

                    PatientTransaction::create([
                        'clinic_id' => $item->clinic_id,
                        'patient_id' => $plan->patient_id,
                        'type' => 'adjustment',
                        'reference_type' => 'plan_item_session_adjust',
                        'reference_id' => $session->id,
                        'amount' => $delta,
                        'currency' => 'ILS',
                        'exchange_rate' => 1,
                        'amount_ils' => $delta,
                        'occurred_at' => now(),
                    ]);

                    $this->paymentService->refreshInvoiceStatus($invoice->fresh());
                }
            }
        });

        return $session->fresh();
    }

    /**
     * Cancels one session: unschedules its appointment, reverses its own
     * invoice line/charge if it was already billed (refunds that slice
     * only — other sessions of the same item are untouched), and rolls
     * back the tooth finding/commission if this was the session that had
     * completed it. Used both by the dedicated "cancel" action per session
     * and when a calendar appointment tied to a session gets deleted.
     */
    public function cancelSession(PlanItemSession $session): PlanItemSession
    {
        $item = $session->planItem()->with('treatmentPlan', 'service')->first();
        $plan = $item->treatmentPlan;

        DB::transaction(function () use ($session, $item, $plan) {
            if ($session->appointment_id) {
                Appointment::whereKey($session->appointment_id)->update(['status' => 'cancelled']);
            }

            $wasDone = $session->status === 'done';
            $session->update(['status' => 'cancelled', 'appointment_id' => null]);

            $line = InvoiceLine::where('plan_item_session_id', $session->id)->first();

            if ($line) {
                $invoice = $line->invoice;
                $refundIls = $line->amount_ils;

                $line->delete();
                $invoice->update(['total_amount_ils' => max(0, $invoice->total_amount_ils - $refundIls)]);

                PatientTransaction::create([
                    'clinic_id' => $item->clinic_id,
                    'patient_id' => $plan->patient_id,
                    'type' => 'refund',
                    'reference_type' => 'plan_item_session_cancel',
                    'reference_id' => $session->id,
                    'amount' => $refundIls,
                    'currency' => 'ILS',
                    'exchange_rate' => 1,
                    'amount_ils' => $refundIls,
                    'occurred_at' => now(),
                ]);

                if ($invoice->lines()->count() === 0) {
                    $invoice->update(['status' => 'void']);
                } else {
                    $this->paymentService->refreshInvoiceStatus($invoice->fresh());
                }
            }

            if ($wasDone && $item->tooth_number) {
                $finding = ToothFinding::where('patient_id', $plan->patient_id)
                    ->where('tooth_number', $item->tooth_number)
                    ->where('service_id', $item->service_id)
                    ->first();

                if ($finding) {
                    $remainingDone = $item->sessions()->where('status', 'done')->count();

                    if ($remainingDone === 0) {
                        DoctorTransaction::where('tooth_finding_id', $finding->id)->whereNull('settled_at')->delete();
                        $finding->delete();
                    } elseif ($finding->status === 'done') {
                        DoctorTransaction::where('tooth_finding_id', $finding->id)->whereNull('settled_at')->delete();
                        $finding->update(['status' => 'in_progress']);
                    }
                }
            }
        });

        return $session->fresh();
    }

    /**
     * Cancels every not-yet-cancelled session of an item in one call — the
     * "cancel this whole item" convenience used by the plan panel and by
     * deleting a calendar appointment (which cancels the item that
     * specific appointment's session belonged to, since a multi-session
     * item still shows as one row in the UI).
     */
    public function cancelItem(PlanItem $item): TreatmentPlan
    {
        $plan = $item->treatmentPlan;
        abort_if($plan->status !== 'approved', 422, 'إلغاء البند بهذا الشكل ممكن فقط ضمن خطة معتمدة.');

        $item->loadMissing('sessions');

        foreach ($item->sessions as $session) {
            if ($session->status !== 'cancelled') {
                $this->cancelSession($session);
            }
        }

        return $plan->fresh(['items.sessions']);
    }

    /**
     * Books the first open slot for the plan's doctor on/after each
     * session's target date (today + (n-1) * service.default_interval_days).
     * Sessions with no slot found within the search window stay pending —
     * the secretary can still book them manually from the calendar.
     */
    public function scheduleSessions(TreatmentPlan $plan): TreatmentPlan
    {
        abort_if($plan->status !== 'approved', 422, 'يجب اعتماد الخطة أولاً.');
        abort_if($plan->doctor_id === null, 422, 'لازم تحدد طبيب للخطة قبل جدولة الجلسات تلقائياً.');

        $plan->loadMissing(['items.sessions', 'items.service', 'patient']);
        $duration = 30;
        $searchWindowDays = 14;

        DB::transaction(function () use ($plan, $duration, $searchWindowDays) {
            foreach ($plan->items as $item) {
                $intervalDays = $item->interval_days ?? $item->service->default_interval_days ?? 7;

                foreach ($item->sessions as $session) {
                    if ($session->status !== 'pending') {
                        continue;
                    }

                    $targetDate = Carbon::today()->addDays(($session->session_number - 1) * $intervalDays);
                    $slot = $this->firstOpenSlot($plan->doctor_id, $plan->patient->branch_id, $targetDate, $duration, $searchWindowDays);

                    if (! $slot) {
                        continue;
                    }

                    $appointment = Appointment::create([
                        'clinic_id' => $plan->clinic_id,
                        'branch_id' => $plan->patient->branch_id,
                        'patient_id' => $plan->patient_id,
                        'doctor_id' => $plan->doctor_id,
                        'starts_at' => $slot['starts_at'],
                        'ends_at' => $slot['ends_at'],
                        'status' => 'scheduled',
                        'created_via' => 'web',
                    ]);

                    $session->update(['status' => 'scheduled', 'appointment_id' => $appointment->id]);
                }
            }
        });

        return $plan->fresh(['items.sessions']);
    }

    protected function firstOpenSlot(int $doctorId, int $branchId, Carbon $fromDate, int $duration, int $windowDays): ?array
    {
        $timezone = config('dentaflow.display_timezone');

        for ($offset = 0; $offset <= $windowDays; $offset++) {
            $date = $fromDate->clone()->addDays($offset)->timezone($timezone)->startOfDay();
            $weekday = $date->dayOfWeek;

            $windows = DB::table('doctor_availability')
                ->where('doctor_id', $doctorId)
                ->where('branch_id', $branchId)
                ->where('weekday', $weekday)
                ->get();

            foreach ($windows as $window) {
                [$startH, $startM] = explode(':', substr($window->start_time, 0, 5));
                [$endH, $endM] = explode(':', substr($window->end_time, 0, 5));

                $cursor = $date->clone()->setTime((int) $startH, (int) $startM);
                $windowEnd = $date->clone()->setTime((int) $endH, (int) $endM);

                while ($cursor->clone()->addMinutes($duration)->lte($windowEnd)) {
                    $slotStart = $cursor->clone();
                    $slotEnd = $cursor->clone()->addMinutes($duration);
                    $slotStartUtc = $slotStart->clone()->timezone('UTC');
                    $slotEndUtc = $slotEnd->clone()->timezone('UTC');

                    $overlaps = Appointment::where('doctor_id', $doctorId)
                        ->whereNotIn('status', ['cancelled', 'no_show'])
                        ->where('starts_at', '<', $slotEndUtc)
                        ->where('ends_at', '>', $slotStartUtc)
                        ->exists();

                    if (! $overlaps) {
                        return ['starts_at' => $slotStartUtc, 'ends_at' => $slotEndUtc];
                    }

                    $cursor->addMinutes($duration);
                }
            }
        }

        return null;
    }

    protected function nextInvoiceNumber(int $clinicId): string
    {
        $count = Invoice::withoutGlobalScopes()->where('clinic_id', $clinicId)->count();

        return sprintf('INV-%06d', $count + 1);
    }
}
