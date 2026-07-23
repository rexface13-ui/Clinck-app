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
use App\Models\ToothState;
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
        ?array $toothNumbers = null,
        ?int $appointmentId = null,
        ?array $pendingTeeth = null,
    ): PlanItemSession {
        $item = $session->planItem()->with('treatmentPlan', 'service')->first();
        $plan = $item->treatmentPlan;

        abort_if($plan->status !== 'approved', 422, 'الخطة لازم تكون معتمدة أولاً.');
        abort_if($session->status === 'done', 422, 'هالجلسة محسوبة مسبقاً.');
        abort_if($session->status === 'cancelled', 422, 'هالجلسة ملغاة.');

        $pendingTeeth = array_values(array_intersect($pendingTeeth ?? [], $toothNumbers ?? []));

        if ($toothNumbers !== null) {
            $pool = $item->allTeeth();
            abort_if(array_diff($toothNumbers, $pool) !== [], 422, 'في سن مختار مو ضمن مجموعة أسنان هالبند بالخطة — عدّل الخطة وضيفه أول.');

            // A tooth that already has a 'done' finding for this service is
            // permanently finished — can't be touched again. A tooth still
            // 'in_progress' (postponed from an earlier visit) is fair game;
            // that's exactly the continuation this session may be closing out.
            $repeated = array_intersect($toothNumbers, $item->doneTeeth());
            abort_if($repeated !== [], 422, 'هالسن اتحسب مسبقاً بجلسة تانية: '.implode('، ', $repeated));
        }

        return DB::transaction(function () use ($session, $item, $plan, $price, $payCashboxId, $payMethod, $toothNumbers, $appointmentId, $pendingTeeth) {
            $sessionLabel = $item->sessions_count > 1 ? " — جلسة {$session->session_number}/{$item->sessions_count}" : '';

            // No work actually billed this visit (pure postponement, "أجّل
            // كمان مرة") — don't create an invoice line or patient charge at
            // all, just record the visit/session and each tooth's progress.
            $invoice = null;
            if ($price > 0) {
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

                InvoiceLine::create([
                    'clinic_id' => $plan->clinic_id,
                    'invoice_id' => $invoice->id,
                    'plan_item_id' => $item->id,
                    'plan_item_session_id' => $session->id,
                    'description' => $item->service->name.($this->teethLabel($toothNumbers ?? $item->allTeeth())).$sessionLabel,
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
            }

            $session->update([
                'status' => 'done',
                'tooth_numbers' => $toothNumbers,
                'appointment_id' => $appointmentId ?? $session->appointment_id,
            ]);

            $teeth = $toothNumbers ?? $item->allTeeth();

            if (! empty($teeth)) {
                $commissionFired = false;

                foreach ($teeth as $toothNumber) {
                    // toothNumbers explicitly given (plan-session flow) means
                    // each tooth is individually either finished today or
                    // still continuing — the caller says which via
                    // pendingTeeth. Only the legacy null-toothNumbers path
                    // (repeat sessions always covering the item's whole pool)
                    // still waits for the last session before marking done.
                    $toothDoneNow = $toothNumbers !== null
                        ? ! in_array($toothNumber, $pendingTeeth, true)
                        : $item->sessions()->where('status', 'done')->count() >= $item->sessions_count;

                    // Some services (extraction chief among them) permanently
                    // remove the tooth — once that's actually done today (not
                    // just started), the tooth flips to missing automatically
                    // instead of relying on staff to remember the checkbox.
                    $marksMissing = $toothDoneNow && $item->service->marks_teeth_missing;

                    $finding = ToothFinding::updateOrCreate(
                        [
                            'patient_id' => $plan->patient_id,
                            'tooth_number' => $toothNumber,
                            'service_id' => $item->service_id,
                        ],
                        [
                            'clinic_id' => $item->clinic_id,
                            'finding_type' => $item->service->name,
                            'status' => $toothDoneNow ? 'done' : 'in_progress',
                            'marks_missing' => $marksMissing,
                            'doctor_id' => $plan->doctor_id,
                            'plan_item_session_id' => $session->id,
                            'recorded_at' => now(),
                        ],
                    );

                    if ($marksMissing) {
                        ToothState::updateOrCreate(
                            ['patient_id' => $plan->patient_id, 'tooth_number' => $toothNumber],
                            ['clinic_id' => $item->clinic_id, 'status' => 'missing'],
                        );
                    }

                    // One item can cover several teeth worked on together in
                    // the same session (e.g. a whole-arch cleaning) — every
                    // tooth still gets its own finding row so the chart/
                    // history is accurate per tooth, but commission is
                    // computed only ONCE per session (off the first tooth
                    // actually finished today), not once per tooth —
                    // otherwise a single flat-fee cleaning across 16 teeth
                    // would pay the doctor commission 16 times over.
                    if ($toothDoneNow && ! $commissionFired) {
                        app(CommissionService::class)->computeForFinding($finding);
                        $commissionFired = true;
                    }
                }
            }

            if ($payCashboxId && $invoice) {
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
            } elseif ($invoice) {
                $this->paymentService->refreshInvoiceStatus($invoice->fresh());
            }

            return $session->fresh();
        });
    }

    /**
     * Records one real-world visit under a plan that may cover several of
     * the plan's services at once (e.g. a cleaning on some teeth + a filling
     * on another, same appointment) — the plan-level counterpart to the
     * same-day "اجاني هلق" walk-in flow. Creates one Appointment (status
     * done, so it behaves everywhere exactly like any other visit — shows on
     * the calendar, and deleting it cascades to cancel every session it
     * covers via the existing appointment-delete handling), bills each
     * chosen line through completeSession(), then collects ONE payment for
     * the visit's combined total rather than one per line.
     */
    public function recordSessionVisit(
        TreatmentPlan $plan,
        array $lines,
        ?int $payCashboxId = null,
        ?string $payMethod = null,
    ): Appointment {
        abort_if($plan->status !== 'approved', 422, 'الخطة لازم تكون معتمدة أولاً.');
        abort_if(empty($lines), 422, 'لازم تختار خدمة واحدة عالأقل.');

        return DB::transaction(function () use ($plan, $lines, $payCashboxId, $payMethod) {
            $plan->loadMissing('patient');

            $appointment = Appointment::create([
                'clinic_id' => $plan->clinic_id,
                'branch_id' => $plan->patient->branch_id,
                'patient_id' => $plan->patient_id,
                'doctor_id' => $plan->doctor_id,
                'starts_at' => now(),
                'ends_at' => now()->addMinutes(30),
                'status' => 'done',
                'created_via' => 'web',
            ]);

            $totalPrice = 0;

            foreach ($lines as $line) {
                $item = $plan->items()->findOrFail($line['item_id']);

                // Reuse a still-pending session slot if the plan has one left,
                // else create a fresh one on the fly — a plan's sessions_count
                // is a starting estimate, never a hard cap on how many times
                // you can actually visit for this service.
                $session = $item->sessions()->where('status', 'pending')->first();
                if (! $session) {
                    $session = PlanItemSession::create([
                        'clinic_id' => $item->clinic_id,
                        'plan_item_id' => $item->id,
                        'session_number' => $item->sessions()->count() + 1,
                        'status' => 'pending',
                    ]);
                }

                $this->completeSession(
                    $session,
                    (float) $line['price'],
                    null,
                    null,
                    $line['tooth_numbers'] ?? null,
                    $appointment->id,
                    $line['pending_teeth'] ?? null,
                );

                $totalPrice += (float) $line['price'];
            }

            if ($payCashboxId) {
                $invoice = $plan->invoices()->where('status', '!=', 'void')->latest('id')->first();
                $cashbox = Cashbox::findOrFail($payCashboxId);
                $this->paymentService->collect(
                    patient: $plan->patient,
                    cashbox: $cashbox,
                    amount: $totalPrice,
                    currency: $cashbox->currency,
                    exchangeRate: 1,
                    method: $payMethod ?? 'cash',
                    invoice: $invoice,
                );
            }

            return $appointment->fresh();
        });
    }

    /**
     * Replaces everything billed under a same-day quick-visit plan (the
     * kind "اجاني هلق"/"تمّت الزيارة" creates, tagged by having an
     * appointment_id) with a fresh set of lines — voids every existing
     * item/session's charge and clinical findings first (same reversal
     * "cancelSession" does, minus touching the appointment, which stays
     * exactly as it was), then bills the new lines the same way
     * recordSessionVisit does. Any payment already collected against this
     * visit's invoice is left untouched — only what was billed changes, so
     * the invoice may end up over/under-paid and needs reconciling
     * separately, same as any other price correction.
     */
    public function rebillVisit(TreatmentPlan $plan, array $lines): TreatmentPlan
    {
        abort_if(! $plan->appointment_id, 422, 'التعديل الكامل متاح بس لزيارات "اجاني هلق"/"تمّت الزيارة".');
        abort_if(empty($lines), 422, 'لازم تختار خدمة واحدة عالأقل.');

        return DB::transaction(function () use ($plan, $lines) {
            $plan->loadMissing('items.sessions', 'patient');

            foreach ($plan->items as $item) {
                foreach ($item->sessions as $session) {
                    if ($session->status === 'cancelled') {
                        continue;
                    }

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
                    }

                    $findings = ToothFinding::where('patient_id', $plan->patient_id)
                        ->where('plan_item_session_id', $session->id)
                        ->get();
                    foreach ($findings as $finding) {
                        DoctorTransaction::where('tooth_finding_id', $finding->id)->whereNull('settled_at')->delete();
                        $finding->delete();
                    }

                    $session->delete();
                }

                $item->delete();
            }

            $invoice = $plan->invoices()->where('status', '!=', 'void')->latest('id')->first();
            if ($invoice && $invoice->lines()->count() === 0) {
                $invoice->update(['status' => 'void']);
            } elseif ($invoice) {
                $this->paymentService->refreshInvoiceStatus($invoice->fresh());
            }

            foreach ($lines as $line) {
                $item = $plan->items()->create([
                    'clinic_id' => $plan->clinic_id,
                    'service_id' => $line['service_id'],
                    'tooth_number' => ! empty($line['tooth_numbers']) ? $line['tooth_numbers'][0] : null,
                    'tooth_numbers' => $line['tooth_numbers'] ?? null,
                    'unit_price' => $line['price'],
                    'currency' => 'ILS',
                    'sessions_count' => 1,
                ]);

                $session = PlanItemSession::create([
                    'clinic_id' => $item->clinic_id,
                    'plan_item_id' => $item->id,
                    'session_number' => 1,
                    'status' => 'pending',
                ]);

                $this->completeSession(
                    $session,
                    (float) $line['price'],
                    null,
                    null,
                    $line['tooth_numbers'] ?? null,
                    $plan->appointment_id,
                    [],
                );
            }

            return $plan->fresh(['doctor', 'items.service', 'items.sessions']);
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

            if ($wasDone) {
                // Only revert findings for the teeth THIS session actually covered
                // (its own subset, if one was recorded) — cancelling one plan
                // session must not touch findings that a different session of the
                // same item recorded for other teeth.
                $teeth = $session->tooth_numbers ?? $item->allTeeth();
                $otherDoneSessions = $item->sessions()->where('status', 'done')->where('id', '!=', $session->id)->get();

                foreach ($teeth as $toothNumber) {
                    $finding = ToothFinding::where('patient_id', $plan->patient_id)
                        ->where('tooth_number', $toothNumber)
                        ->where('service_id', $item->service_id)
                        ->first();

                    if (! $finding) {
                        continue;
                    }

                    $stillCoveredByAnotherSession = $otherDoneSessions->contains(
                        fn ($s) => $s->tooth_numbers === null || in_array($toothNumber, $s->tooth_numbers, true)
                    );

                    if ($stillCoveredByAnotherSession) {
                        continue;
                    }

                    DoctorTransaction::where('tooth_finding_id', $finding->id)->whereNull('settled_at')->delete();

                    if ($otherDoneSessions->isEmpty()) {
                        $finding->delete();
                    } else {
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

    protected function teethLabel(array $teeth): string
    {
        if (empty($teeth)) {
            return '';
        }

        return count($teeth) === 1 ? " (سن {$teeth[0]})" : ' ('.count($teeth).' سن: '.implode('، ', $teeth).')';
    }
}
