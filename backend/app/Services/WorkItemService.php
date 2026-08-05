<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Cashbox;
use App\Models\DoctorTransaction;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Service;
use App\Models\ToothFinding;
use App\Models\ToothState;
use App\Models\WorkItem;
use App\Models\WorkItemStep;
use App\Models\WorkItemTooth;
use App\Models\WorkItemToothStep;
use Illuminate\Support\Facades\DB;

class WorkItemService
{
    public function __construct(protected PaymentService $paymentService, protected CommissionService $commissionService)
    {
    }

    /**
     * Starts a new work item: a service applied to a group of teeth for a
     * patient. Snapshots the service's current step definitions (title +
     * price) onto the work item so later edits to the service don't
     * retroactively change what's already in progress, and pre-creates one
     * tracking row per (tooth, step) so the UI has something to check off.
     */
    public function create(Patient $patient, ?int $doctorId, Service $service, array $teeth): WorkItem
    {
        abort_if(empty($teeth), 422, 'لازم تحدد سن واحد عالأقل.');
        $this->assertTeethAllowed($patient, $service, $teeth);

        return DB::transaction(function () use ($patient, $doctorId, $service, $teeth) {
            $workItem = WorkItem::create([
                'patient_id' => $patient->id,
                'doctor_id' => $doctorId,
                'service_id' => $service->id,
                'price_per_tooth' => $service->price_per_tooth,
                'status' => 'in_progress',
            ]);

            foreach ($teeth as $toothNumber) {
                WorkItemTooth::create(['work_item_id' => $workItem->id, 'tooth_number' => $toothNumber]);
            }

            $service->loadMissing('steps.fields');

            // A service with no steps configured is still a normal,
            // one-shot billable service (most services never get broken
            // into steps) — synthesize a single implicit step from the
            // service itself so there's something to check off and bill,
            // instead of creating a work item that can never be completed.
            $steps = $service->steps->isNotEmpty()
                ? $service->steps
                : collect([(object) ['id' => null, 'title' => $service->name, 'price' => $service->default_price, 'sort_order' => 1]]);

            foreach ($steps as $step) {
                $workItemStep = WorkItemStep::create([
                    'work_item_id' => $workItem->id,
                    'service_step_id' => $step->id,
                    'title' => $step->title,
                    'price' => $step->price,
                    'sort_order' => $step->sort_order,
                ]);

                foreach ($teeth as $toothNumber) {
                    WorkItemToothStep::create([
                        'work_item_id' => $workItem->id,
                        'tooth_number' => $toothNumber,
                        'work_item_step_id' => $workItemStep->id,
                    ]);
                }
            }

            return $workItem->fresh(['teeth', 'steps.toothSteps', 'steps.serviceStep.fields']);
        });
    }

    protected function assertTeethAllowed(Patient $patient, Service $service, array $teeth): void
    {
        if ($service->allows_missing_teeth) {
            return;
        }

        $missingTeeth = ToothState::where('patient_id', $patient->id)
            ->where('status', 'missing')
            ->whereIn('tooth_number', $teeth)
            ->pluck('tooth_number');

        abort_if($missingTeeth->isNotEmpty(), 422, 'هالأسنان مسجّلة مفقودة، وهاي الخدمة ما بتسمح تشتغل عليها: '.$missingTeeth->implode('، '));
    }

    /** Adds more teeth to an already-started work item — same per-step tracking rows create() sets up for a brand-new item, just skipping any tooth already on it. */
    public function addTeeth(WorkItem $workItem, array $teeth): WorkItem
    {
        abort_if(empty($teeth), 422, 'لازم تحدد سن واحد عالأقل.');

        $workItem->loadMissing('patient', 'service', 'teeth', 'steps');
        $existing = $workItem->toothNumbers();
        $newTeeth = array_values(array_diff(array_map('intval', $teeth), $existing));

        if (empty($newTeeth)) {
            return $workItem->fresh(['teeth', 'steps.toothSteps', 'steps.serviceStep.fields']);
        }

        $this->assertTeethAllowed($workItem->patient, $workItem->service, $newTeeth);

        DB::transaction(function () use ($workItem, $newTeeth) {
            foreach ($newTeeth as $toothNumber) {
                WorkItemTooth::create(['work_item_id' => $workItem->id, 'tooth_number' => $toothNumber]);

                foreach ($workItem->steps as $step) {
                    WorkItemToothStep::create([
                        'work_item_id' => $workItem->id,
                        'tooth_number' => $toothNumber,
                        'work_item_step_id' => $step->id,
                    ]);
                }
            }
        });

        return $workItem->fresh(['teeth', 'steps.toothSteps', 'steps.serviceStep.fields']);
    }

    /**
     * Drops one tooth entirely from a work item — reverses billing on any of
     * its tooth-steps that were already invoiced (same reversal
     * reverseBilledToothStep() does for a single un-check), then deletes its
     * tracking rows. A tooth-step under a flat-fee (!price_per_tooth) step
     * that's been billed can't be individually reversed — reverseBilledToothStep()
     * already enforces that — so removing a tooth with billed flat-fee work
     * on it fails with a clear message instead of silently losing the charge.
     */
    public function removeTooth(WorkItem $workItem, int $toothNumber): void
    {
        $workItem->loadMissing('teeth', 'toothSteps');

        $isLastTooth = $workItem->teeth->count() <= 1;

        DB::transaction(function () use ($workItem, $toothNumber, $isLastTooth) {
            $toothSteps = $workItem->toothSteps->where('tooth_number', $toothNumber);

            foreach ($toothSteps as $toothStep) {
                if ($toothStep->invoice_line_id) {
                    $this->reverseBilledToothStep($toothStep);
                }
            }

            WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', $toothNumber)->delete();
            WorkItemTooth::where('work_item_id', $workItem->id)->where('tooth_number', $toothNumber)->delete();

            $this->recomputeToothFinding($workItem->patient_id, $toothNumber, $workItem->service_id);

            // Removing the session's only remaining tooth used to be a hard
            // error ("إلغي الشغلة كاملة بدل هيك") that the edit-session form
            // had no actual way to satisfy — there was no whole-item delete
            // reachable from there, so the item just got stuck forever at
            // one tooth, status still 'in_progress', showing up as open work
            // on that tooth with nothing left to edit. Cancel it instead.
            if ($isLastTooth) {
                $workItem->update(['status' => 'cancelled']);

                return;
            }

            // Dropping a pending tooth can be what finishes the session off.
            $this->refreshWorkItemStatus($workItem);
        });
    }

    /**
     * Corrects a step's price. If nothing's billed yet, this only affects
     * future charges. If some tooth-steps under it were already invoiced,
     * the delta is also applied to the existing invoice line(s) so the
     * correction shows up in the same invoice/ledger instead of silently
     * only affecting new work — price_per_tooth steps get one line per
     * tooth adjusted individually, flat-fee steps share a single line.
     */
    public function updateStepPrice(WorkItemStep $step, float $price): WorkItemStep
    {
        $oldPrice = (float) $step->price;
        $delta = round($price - $oldPrice, 2);
        $step->update(['price' => $price]);

        if ($delta !== 0.0) {
            $step->loadMissing('workItem', 'toothSteps.invoiceLine.invoice');
            $billed = $step->toothSteps->filter(fn ($ts) => $ts->invoice_line_id);

            if ($billed->isNotEmpty()) {
                $lines = $step->workItem->price_per_tooth
                    ? $billed->pluck('invoiceLine')->filter()->unique('id')
                    : $billed->pluck('invoiceLine')->filter()->unique('id')->take(1);

                foreach ($lines as $line) {
                    $this->adjustInvoiceLineAmount($line, $delta, $step->workItem->patient_id);
                }
            }
        }

        return $step->fresh();
    }

    /**
     * Bumps an already-issued invoice line's amount by a signed delta and
     * posts a matching 'adjustment' ledger entry — same pattern as
     * reverseBilledToothStep() but corrects the amount in place instead of
     * deleting the line, since the work itself is still valid.
     */
    protected function adjustInvoiceLineAmount(InvoiceLine $line, float $delta, int $patientId): void
    {
        $line->increment('amount_ils', $delta);
        $line->increment('amount', $delta);
        $invoice = $line->invoice;
        $invoice->increment('total_amount_ils', $delta);

        PatientTransaction::create([
            'patient_id' => $patientId,
            'type' => 'adjustment',
            'reference_type' => 'invoice_line_reprice',
            'reference_id' => $invoice->id,
            'amount' => $delta,
            'currency' => 'ILS',
            'exchange_rate' => 1,
            'amount_ils' => $delta,
            'occurred_at' => now(),
        ]);

        $this->paymentService->refreshInvoiceStatus($invoice->fresh());
    }

    /**
     * Corrects how much was actually collected for one session, moving the
     * signed difference through the same cashbox/ledger paths a normal
     * checkout payment would use — a positive delta collects more, a
     * negative delta refunds the difference back out of the cashbox.
     */
    public function updateCollectedAmount(WorkItem $workItem, float $newAmount, ?int $cashboxId, ?string $method, float $exchangeRate = 1): WorkItem
    {
        // Measured against what was genuinely collected (derived from the
        // payments themselves), never against the `collected_amount_ils`
        // column — checkout() never populated that column, so it read 0 even
        // for a fully-paid session, and re-typing the true figure was charged
        // to the patient all over again.
        // The figure shown here is capped at what the session cost, so letting
        // someone type more than that wouldn't survive a reload — they'd see
        // the capped number next time, "correct" it again, and be charged the
        // difference over and over. A genuine overpayment is a credit on the
        // account, not a property of one session.
        $billed = $workItem->billedAmountIls();
        abort_if(
            $billed > 0 && $newAmount > $billed + 0.01,
            422,
            'المبلغ المحصّل ما بصير يزيد عن قيمة الجلسة ('.number_format($billed, 2).' ₪). لو المريض دفع أكتر، سجّلها دفعة عامة من كشف الحساب.',
        );

        $delta = round($newAmount - $workItem->actualCollectedIls(), 2);

        if ($delta === 0.0) {
            return $workItem->fresh();
        }

        $workItem->loadMissing('patient');
        $invoice = $this->invoiceForWorkItem($workItem);
        abort_unless($invoice, 422, 'ما في فاتورة مرتبطة بهاي الجلسة بعد — لازم يكون فيها شي محسوب الأول.');
        abort_unless($cashboxId, 422, 'لازم تختار الصندوق.');
        $cashbox = Cashbox::findOrFail($cashboxId);

        DB::transaction(function () use ($workItem, $newAmount, $delta, $cashbox, $method, $exchangeRate, $invoice) {
            if ($delta > 0) {
                $this->paymentService->collect(
                    patient: $workItem->patient,
                    cashbox: $cashbox,
                    amount: $delta,
                    currency: $cashbox->currency,
                    exchangeRate: $exchangeRate,
                    method: $method ?? 'cash',
                    invoice: $invoice,
                );
            } else {
                $this->paymentService->refund(
                    patient: $workItem->patient,
                    cashbox: $cashbox,
                    amount: abs($delta),
                    currency: $cashbox->currency,
                    exchangeRate: $exchangeRate,
                    method: $method ?? 'cash',
                    invoice: $invoice,
                );
            }

            $workItem->update(['collected_amount_ils' => $newAmount]);
        });

        return $workItem->fresh();
    }

    /** The invoice this session's charges landed in — same invoice checkout() created/appended to. */
    protected function invoiceForWorkItem(WorkItem $workItem): ?Invoice
    {
        $workItem->loadMissing('toothSteps.invoiceLine.invoice');

        return $workItem->toothSteps->first(fn ($ts) => $ts->invoiceLine)?->invoiceLine?->invoice;
    }

    /**
     * Recomputes a (patient, tooth, service) ToothFinding from whatever
     * work-item progress actually still exists after a reversal/removal —
     * deletes it if nothing's completed anymore, otherwise sets it to
     * 'done'/'in_progress' same as recordFindingsAndCommission() would.
     * Without this, undoing a tooth-step (or removing the tooth entirely)
     * left the chart showing a stale "done"/"in_progress" tooth forever.
     */
    protected function recomputeToothFinding(int $patientId, int $toothNumber, ?int $serviceId): void
    {
        if (! $serviceId) {
            return;
        }

        $steps = WorkItemToothStep::query()
            ->where('tooth_number', $toothNumber)
            ->whereHas('workItem', fn ($q) => $q->where('patient_id', $patientId)->where('service_id', $serviceId)->where('status', '!=', 'cancelled'))
            ->get();

        $finding = ToothFinding::where('patient_id', $patientId)->where('tooth_number', $toothNumber)->where('service_id', $serviceId)->first();

        if (! $finding) {
            return;
        }

        $completedCount = $steps->filter(fn ($ts) => $ts->completed_at)->count();

        if ($completedCount === 0) {
            $this->reverseCommissionFor($finding);
            $finding->delete();

            return;
        }

        $finding->update(['status' => $completedCount === $steps->count() ? 'done' : 'in_progress']);
    }

    /**
     * Cancels out the commission a doctor earned for work that has since been
     * reversed or cancelled.
     *
     * The commission row points at the ToothFinding, and that link is
     * nullOnDelete — so deleting the finding used to leave the commission
     * standing but detached: the doctor stayed owed for treatment that never
     * happened, and the amount lost every trace of which patient or tooth it
     * came from. Posting an explicit negative entry (rather than deleting the
     * original) nets the doctor back to zero while keeping both sides of the
     * story on their statement, same as how patient-side reversals work.
     */
    protected function reverseCommissionFor(ToothFinding $finding): void
    {
        $commissions = DoctorTransaction::where('tooth_finding_id', $finding->id)
            ->where('type', 'commission')
            ->get();

        foreach ($commissions as $commission) {
            if ((float) $commission->amount_ils === 0.0) {
                continue;
            }

            DoctorTransaction::create([
                'clinic_id' => $commission->clinic_id,
                'doctor_id' => $commission->doctor_id,
                'tooth_finding_id' => null,
                'type' => 'commission',
                'amount_ils' => -(float) $commission->amount_ils,
                'period_month' => $commission->period_month,
                'notes' => 'عكس عمولة — الشغل انلغى أو انعكس'
                    .($finding->tooth_number ? ' (سن '.$finding->tooth_number.')' : ''),
            ]);
        }
    }

    /** Toggles one tooth's progress on one step, and/or saves its field values. Nothing is billed here — billing happens at checkout(). */
    public function updateToothStep(WorkItemToothStep $toothStep, ?bool $completed, ?array $fieldValues): WorkItemToothStep
    {
        if ($fieldValues !== null) {
            $toothStep->update(['field_values' => $fieldValues]);
        }

        if ($completed === true) {
            $toothStep->update(['completed_at' => $toothStep->completed_at ?? now()]);
        } elseif ($completed === false) {
            if ($toothStep->invoice_line_id) {
                // Already billed in a prior checkout — un-checking it isn't a
                // free no-op, it has to give the money back too, otherwise
                // the tooth reads as "not done" while the patient was still
                // charged for it.
                $this->reverseBilledToothStep($toothStep);
            } else {
                $toothStep->update(['completed_at' => null]);
            }
        }

        if ($completed !== null) {
            $this->refreshWorkItemStatus($toothStep->workItem);
        }

        return $toothStep->fresh();
    }

    /**
     * A session is "done" only while every one of its tooth-steps is ticked.
     * The status used to be worked out at checkout and never again, so
     * un-ticking a tooth of an old session left it still reading "منجز" — it
     * stayed off the list of work the patient still owes a visit for, even
     * though a tooth on it was now pending. Re-ticking had the mirror problem.
     * A cancelled session stays cancelled; that isn't a progress state.
     */
    protected function refreshWorkItemStatus(?WorkItem $workItem): void
    {
        if (! $workItem || $workItem->status === 'cancelled') {
            return;
        }

        $status = $this->isWorkItemDone($workItem->fresh('toothSteps')) ? 'done' : 'in_progress';

        if ($workItem->status !== $status) {
            $workItem->update(['status' => $status]);
        }
    }

    /**
     * Undoes a tooth-step that was already invoiced in an earlier session:
     * deletes its invoice line, shrinks the invoice total, and records a
     * matching negative adjustment on the patient's ledger so the reversal
     * is visible there too. Only possible for price_per_tooth services —
     * a flat-fee step's single invoice line is shared across every tooth
     * that had it, so there's no single tooth's worth of price to hand back.
     */
    protected function reverseBilledToothStep(WorkItemToothStep $toothStep): void
    {
        $toothStep->loadMissing('workItem');
        abort_unless($toothStep->workItem->price_per_tooth, 422, 'ما فيك تلغي سن واحد من خطوة سعرها إجمالي وليس فردي — لازم تلغي كل الخطوة.');

        DB::transaction(function () use ($toothStep) {
            $line = InvoiceLine::find($toothStep->invoice_line_id);

            if ($line) {
                $invoice = $line->invoice;
                $price = (float) $line->amount_ils;
                $line->delete();

                // total_amount_ils isn't always the sum of invoice lines — a
                // manual discount (PaymentService::adjustTotal) can have
                // already shrunk it independently of the lines. Reversing by
                // the line's full original price would overshoot past what's
                // actually left (and go negative) whenever a discount was
                // applied on top of this line. Clamp the actual reversal to
                // what's still on the invoice, and post that same amount to
                // the ledger so the two stay consistent.
                $actualReversal = min($price, (float) $invoice->total_amount_ils);
                $invoice->update(['total_amount_ils' => max(0, (float) $invoice->total_amount_ils - $actualReversal)]);

                PatientTransaction::create([
                    'patient_id' => $toothStep->workItem->patient_id,
                    'type' => 'adjustment',
                    'reference_type' => 'invoice_line_reversal',
                    'reference_id' => $invoice->id,
                    'amount' => -$actualReversal,
                    'currency' => 'ILS',
                    'exchange_rate' => 1,
                    'amount_ils' => -$actualReversal,
                    'occurred_at' => now(),
                ]);

                $this->paymentService->refreshInvoiceStatus($invoice->fresh());
            }

            $toothStep->update(['completed_at' => null, 'invoice_line_id' => null]);

            $this->recomputeToothFinding($toothStep->workItem->patient_id, (int) $toothStep->tooth_number, $toothStep->workItem->service_id);
        });
    }

    /** Copies one tooth's step field values (and completion) to every other tooth in the same work item — the "طبّق نفس القيم على كل الأسنان" shortcut. */
    public function applyToAllTeeth(WorkItem $workItem, int $sourceTooth): void
    {
        $workItem->loadMissing('toothSteps');

        $bySource = $workItem->toothSteps->where('tooth_number', $sourceTooth)->keyBy('work_item_step_id');

        DB::transaction(function () use ($workItem, $bySource) {
            foreach ($workItem->toothSteps as $ts) {
                $source = $bySource->get($ts->work_item_step_id);
                if (! $source || $ts->id === $source->id) {
                    continue;
                }

                // Field values carry no money, so they copy straight across
                // (including a null, which means "nothing recorded").
                $ts->update(['field_values' => $source->field_values]);

                // Completion does carry money, so it goes through
                // updateToothStep. Copying an un-ticked source across the
                // session used to clear the tick on teeth that were already
                // invoiced while leaving invoice_line_id in place — the tooth
                // read as "not done" and the patient stayed charged for it,
                // the exact thing reverseBilledToothStep() exists to prevent.
                $this->updateToothStep($ts, $source->completed_at !== null, null);
            }
        });
    }

    /**
     * Bills every not-yet-invoiced completed tooth-step across the given
     * work items in one invoice, records clinical findings + commission,
     * links to (or creates) today's appointment, and optionally collects
     * payment. Work items with steps still incomplete stay "in_progress" —
     * that's what shows up as a scheduled/pending session for the patient.
     */
    public function checkout(
        Patient $patient,
        array $workItemIds,
        int $doctorId,
        float $discountAmount = 0,
        ?int $payCashboxId = null,
        ?string $payMethod = null,
        ?int $appointmentId = null,
        ?float $payAmount = null,
    ): array {
        abort_if(empty($workItemIds), 422, 'لازم تختار شغل واحد عالأقل.');

        return DB::transaction(function () use ($patient, $workItemIds, $doctorId, $discountAmount, $payCashboxId, $payMethod, $appointmentId, $payAmount) {
            $workItems = WorkItem::with(['teeth', 'service', 'toothSteps.step'])
                ->where('patient_id', $patient->id)
                ->whereIn('id', $workItemIds)
                ->get();

            abort_if($workItems->isEmpty(), 404, 'ما في شغل مطابق.');

            $appointment = $this->resolveAppointment($patient, $doctorId, $appointmentId);

            $invoice = null;
            $invoiceTotal = 0;

            foreach ($workItems as $workItem) {
                $charges = $this->billableCharges($workItem);

                foreach ($charges as $charge) {
                    if (! $invoice) {
                        $invoice = Invoice::create([
                            'patient_id' => $patient->id,
                            'invoice_number' => $this->nextInvoiceNumber(),
                            'status' => 'unpaid',
                            'total_amount_ils' => 0,
                            'issued_at' => now(),
                        ]);
                    }

                    $line = InvoiceLine::create([
                        'invoice_id' => $invoice->id,
                        'work_item_tooth_step_id' => $charge['bill_tooth_step_id'],
                        'description' => $charge['description'],
                        'amount' => $charge['price'],
                        'currency' => 'ILS',
                        'exchange_rate' => 1,
                        'amount_ils' => $charge['price'],
                    ]);

                    WorkItemToothStep::whereIn('id', $charge['tooth_step_ids'])->update(['invoice_line_id' => $line->id]);

                    $invoiceTotal += $charge['price'];
                }

                $this->recordFindingsAndCommission($workItem, $doctorId);

                $workItem->update([
                    'doctor_id' => $doctorId,
                    // Only ever set the link, never clear it. resolveAppointment()
                    // returns null for a walk-in, and writing that null used to
                    // wipe the visit a session was already booked under — the
                    // work vanished from that visit's history, and the guard that
                    // stops a billed visit being deleted stopped seeing it, so
                    // the visit could be deleted with its invoice left behind.
                    ...($appointment ? ['appointment_id' => $appointment->id] : []),
                    'status' => $this->isWorkItemDone($workItem->fresh('toothSteps')) ? 'done' : 'in_progress',
                ]);
            }

            if ($invoice) {
                $invoice->update(['total_amount_ils' => $invoiceTotal]);

                PatientTransaction::create([
                    'patient_id' => $patient->id,
                    'type' => 'charge',
                    'reference_type' => 'invoice',
                    'reference_id' => $invoice->id,
                    'amount' => $invoiceTotal,
                    'currency' => 'ILS',
                    'exchange_rate' => 1,
                    'amount_ils' => $invoiceTotal,
                    'occurred_at' => now(),
                ]);

                if ($discountAmount > 0) {
                    $discountAmount = min($discountAmount, $invoiceTotal);
                    $invoice->update(['total_amount_ils' => $invoiceTotal - $discountAmount]);

                    PatientTransaction::create([
                        'patient_id' => $patient->id,
                        'type' => 'adjustment',
                        'reference_type' => 'invoice_discount',
                        'reference_id' => $invoice->id,
                        'amount' => -$discountAmount,
                        'currency' => 'ILS',
                        'exchange_rate' => 1,
                        'amount_ils' => -$discountAmount,
                        'occurred_at' => now(),
                    ]);
                }

                // Partial payment is allowed on purpose — a patient can pay
                // any amount (including zero) at checkout and the rest just
                // stays as debt on their ledger, no forced full-pay-or-defer
                // choice.
                $amountToCollect = $payAmount ?? (float) $invoice->fresh()->total_amount_ils;
                $amountToCollect = min(max(0, $amountToCollect), (float) $invoice->fresh()->total_amount_ils);

                if ($payCashboxId && $amountToCollect > 0) {
                    $cashbox = Cashbox::findOrFail($payCashboxId);
                    $this->paymentService->collect(
                        patient: $patient,
                        cashbox: $cashbox,
                        amount: $amountToCollect,
                        currency: $cashbox->currency,
                        exchangeRate: 1,
                        method: $payMethod ?? 'cash',
                        invoice: $invoice,
                    );
                } else {
                    $this->paymentService->refreshInvoiceStatus($invoice->fresh());
                }
            }

            return [
                'invoice_id' => $invoice?->id,
                'total_ils' => $invoice ? (float) $invoice->fresh()->total_amount_ils : 0,
                'appointment_id' => $appointment?->id,
                'work_items' => $workItems->fresh(['teeth', 'steps.toothSteps', 'steps.serviceStep.fields', 'toothSteps.invoiceLine.invoice.payments', 'toothSteps.invoiceLine.invoice.lines'])->all(),
            ];
        });
    }

    /**
     * What to actually bill for one work item's newly-completed, not-yet-invoiced
     * tooth-steps: per_tooth services charge each tooth's completion of a step
     * separately; flat services charge a step's price once no matter how many
     * teeth complete it (skips entirely once any tooth-step for that step has
     * ever been invoiced).
     */
    protected function billableCharges(WorkItem $workItem): array
    {
        $teethLabel = fn (array $teeth) => count($teeth) === 1 ? " (سن {$teeth[0]})" : ' ('.count($teeth).' سن: '.implode('، ', $teeth).')';

        $pending = $workItem->toothSteps->filter(fn ($ts) => $ts->completed_at && ! $ts->invoice_line_id);

        if ($pending->isEmpty()) {
            return [];
        }

        $charges = [];

        if ($workItem->price_per_tooth) {
            foreach ($pending as $ts) {
                $charges[] = [
                    'price' => (float) $ts->step->price,
                    'description' => $workItem->service->name.' — '.$ts->step->title.$teethLabel([$ts->tooth_number]),
                    'tooth_step_ids' => [$ts->id],
                    'bill_tooth_step_id' => $ts->id,
                ];
            }

            return $charges;
        }

        foreach ($pending->groupBy('work_item_step_id') as $stepId => $group) {
            $existingLineId = WorkItemToothStep::where('work_item_step_id', $stepId)->whereNotNull('invoice_line_id')->value('invoice_line_id');
            $ids = $group->pluck('id')->all();

            if ($existingLineId) {
                // Free — the flat fee for this step was already charged once;
                // just tag these newly-completed rows so they don't show as
                // billable again, without creating a second invoice line.
                WorkItemToothStep::whereIn('id', $ids)->update(['invoice_line_id' => $existingLineId]);

                continue;
            }

            $first = $group->first();
            $teeth = $group->pluck('tooth_number')->map(fn ($n) => (int) $n)->all();

            $charges[] = [
                'price' => (float) $first->step->price,
                'description' => $workItem->service->name.' — '.$first->step->title.$teethLabel($teeth),
                'tooth_step_ids' => $ids,
                'bill_tooth_step_id' => $first->id,
            ];
        }

        return $charges;
    }

    /** One ToothFinding per (patient, tooth, service) reflecting current progress — 'done' once every step for that tooth is checked off, 'in_progress' otherwise. Commission fires once, the moment a tooth first reaches 'done'. */
    protected function recordFindingsAndCommission(WorkItem $workItem, int $doctorId): void
    {
        $byTooth = $workItem->toothSteps->groupBy('tooth_number');

        foreach ($byTooth as $toothNumber => $steps) {
            $completedCount = $steps->filter(fn ($ts) => $ts->completed_at)->count();

            // A bridge/appliance's "pontic" teeth (the ones in the middle,
            // spanning between the billed anchor teeth) often never get a
            // step individually checked off — nothing's separately done
            // to them. Without this they'd never get a ToothFinding at
            // all, and the chart would only ever color the anchor teeth,
            // leaving a "floating" bridge line over blank teeth. A
            // spans_teeth service still records them (as 'planned', no
            // commission) purely so the whole span reads as one
            // appliance; any other service keeps the original behavior
            // of staying silent until something's actually done.
            if ($completedCount === 0) {
                if ($workItem->service->spans_teeth) {
                    ToothFinding::updateOrCreate(
                        ['patient_id' => $workItem->patient_id, 'tooth_number' => $toothNumber, 'service_id' => $workItem->service_id],
                        ['finding_type' => $workItem->service->name, 'status' => 'planned', 'doctor_id' => $doctorId, 'work_item_tooth_step_id' => $steps->first()->id, 'recorded_at' => now()],
                    );
                }
                continue;
            }

            $isDone = $completedCount === $steps->count();
            $wasDoneAlready = ToothFinding::where('patient_id', $workItem->patient_id)
                ->where('tooth_number', $toothNumber)
                ->where('service_id', $workItem->service_id)
                ->where('status', 'done')
                ->exists();

            // A tooth already finished (and billed/committed) on an earlier
            // checkout of this same work item is untouched here — otherwise
            // checking out a *different* tooth later (possibly under a
            // different supervising doctor) would silently overwrite this
            // tooth's doctor credit and recorded_at date, even though
            // nothing about it actually changed today.
            if ($wasDoneAlready) {
                continue;
            }

            $marksMissing = $isDone && $workItem->service->marks_teeth_missing;

            $finding = ToothFinding::updateOrCreate(
                ['patient_id' => $workItem->patient_id, 'tooth_number' => $toothNumber, 'service_id' => $workItem->service_id],
                [
                    'finding_type' => $workItem->service->name,
                    'status' => $isDone ? 'done' : 'in_progress',
                    'marks_missing' => $marksMissing,
                    'doctor_id' => $doctorId,
                    'work_item_tooth_step_id' => $steps->last()->id,
                    'recorded_at' => now(),
                ],
            );

            if ($marksMissing) {
                ToothState::updateOrCreate(
                    ['patient_id' => $workItem->patient_id, 'tooth_number' => $toothNumber],
                    ['status' => 'missing'],
                );
            } elseif ($isDone && $workItem->service->allows_missing_teeth) {
                // A service that's allowed to work on a missing tooth (implant
                // and the like) restores it once finished — the tooth is
                // physically there again, so it shouldn't stay flagged missing
                // or stay excluded from "تحديد الكل"/future service picks.
                ToothState::updateOrCreate(
                    ['patient_id' => $workItem->patient_id, 'tooth_number' => $toothNumber],
                    ['status' => 'present'],
                );
            }

            if ($isDone && ! $wasDoneAlready) {
                $toothPrice = (float) $steps->sum(fn ($ts) => $ts->step->price);
                $this->commissionService->computeForFinding($finding, $toothPrice);
            }
        }
    }

    protected function isWorkItemDone(WorkItem $workItem): bool
    {
        return $workItem->toothSteps->every(fn ($ts) => $ts->completed_at !== null);
    }

    /** Reuses today's already-booked appointment for this patient (marking it done) rather than creating a duplicate, unless the caller explicitly picked a different one. */
    protected function resolveAppointment(Patient $patient, int $doctorId, ?int $appointmentId): ?Appointment
    {
        if ($appointmentId) {
            $appointment = Appointment::findOrFail($appointmentId);
            abort_unless($appointment->patient_id === $patient->id, 422, 'الموعد لا يخص هذا المريض.');
            $appointment->update(['status' => 'done', 'doctor_id' => $doctorId]);

            return $appointment;
        }

        $today = Appointment::where('patient_id', $patient->id)
            ->whereIn('status', ['scheduled', 'confirmed'])
            ->whereDate('starts_at', now()->toDateString())
            ->first();

        if ($today) {
            $today->update(['status' => 'done', 'doctor_id' => $doctorId]);

            return $today;
        }

        // No booked appointment for this checkout — a pure walk-in shouldn't
        // get a phantom "done" appointment fabricated just so the work item
        // has something to point at. Leaving it null keeps the appointments
        // calendar/log showing only real bookings.
        return null;
    }

    /** Books an appointment for a work item's remaining (not-yet-completed) steps — the "جلسة مجدولة" the patient still owes a visit for. */
    public function scheduleRemaining(WorkItem $workItem, string $startsAt, string $endsAt): Appointment
    {
        $workItem->loadMissing('patient');

        $appointment = Appointment::create([
            'branch_id' => $workItem->patient->branch_id,
            'patient_id' => $workItem->patient_id,
            'doctor_id' => $workItem->doctor_id,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
            'status' => 'scheduled',
            'created_via' => 'web',
        ]);

        $workItem->update(['appointment_id' => $appointment->id]);

        return $appointment;
    }

    /**
     * Cancels a work item entirely — a manual "احذف الشغل" escape hatch for
     * when removing teeth one at a time is too slow/awkward. Reverses any
     * already-billed invoice lines first (once per unique line, not per
     * tooth-step — a flat-fee step's line is shared across every tooth that
     * had it), so this works regardless of billing status instead of
     * refusing outright.
     */
    public function cancel(WorkItem $workItem): void
    {
        DB::transaction(function () use ($workItem) {
            $toothSteps = $workItem->toothSteps()->whereNotNull('invoice_line_id')->get();
            $lineIds = $toothSteps->pluck('invoice_line_id')->unique();

            foreach ($lineIds as $lineId) {
                $line = InvoiceLine::find($lineId);
                if (! $line) {
                    continue;
                }

                $invoice = $line->invoice;
                $price = (float) $line->amount_ils;
                $line->delete();

                $actualReversal = min($price, (float) $invoice->total_amount_ils);
                $invoice->update(['total_amount_ils' => max(0, (float) $invoice->total_amount_ils - $actualReversal)]);

                PatientTransaction::create([
                    'patient_id' => $workItem->patient_id,
                    'type' => 'adjustment',
                    'reference_type' => 'invoice_line_reversal',
                    'reference_id' => $invoice->id,
                    'amount' => -$actualReversal,
                    'currency' => 'ILS',
                    'exchange_rate' => 1,
                    'amount_ils' => -$actualReversal,
                    'occurred_at' => now(),
                ]);

                $this->paymentService->refreshInvoiceStatus($invoice->fresh());
            }

            WorkItemToothStep::where('work_item_id', $workItem->id)->update(['completed_at' => null, 'invoice_line_id' => null]);

            foreach ($toothSteps->pluck('tooth_number')->unique() as $toothNumber) {
                $this->recomputeToothFinding($workItem->patient_id, (int) $toothNumber, $workItem->service_id);
            }

            $workItem->update(['status' => 'cancelled']);
        });
    }

    protected function nextInvoiceNumber(): string
    {
        $lastNumber = Invoice::withoutGlobalScopes()
            ->whereRaw("invoice_number ~ '^INV-[0-9]+$'")
            ->orderByRaw("CAST(SUBSTRING(invoice_number FROM 5) AS INTEGER) DESC")
            ->lockForUpdate()
            ->value('invoice_number');

        $next = $lastNumber ? ((int) substr($lastNumber, 4)) + 1 : 1;

        return sprintf('INV-%06d', $next);
    }
}
