<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Cashbox;
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

        if (! $service->allows_missing_teeth) {
            $missingTeeth = ToothState::where('patient_id', $patient->id)
                ->where('status', 'missing')
                ->whereIn('tooth_number', $teeth)
                ->pluck('tooth_number');

            abort_if($missingTeeth->isNotEmpty(), 422, 'هالأسنان مسجّلة مفقودة، وهاي الخدمة ما بتسمح تشتغل عليها: '.$missingTeeth->implode('، '));
        }

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

            foreach ($service->steps as $step) {
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

    /** Toggles one tooth's progress on one step, and/or saves its field values. Nothing is billed here — billing happens at checkout(). */
    public function updateToothStep(WorkItemToothStep $toothStep, ?bool $completed, ?array $fieldValues): WorkItemToothStep
    {
        $data = [];
        if ($fieldValues !== null) {
            $data['field_values'] = $fieldValues;
        }
        if ($completed !== null) {
            $data['completed_at'] = $completed ? ($toothStep->completed_at ?? now()) : null;
        }

        $toothStep->update($data);

        return $toothStep->fresh();
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
                $ts->update(['field_values' => $source->field_values, 'completed_at' => $source->completed_at]);
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
    ): array {
        abort_if(empty($workItemIds), 422, 'لازم تختار شغل واحد عالأقل.');

        return DB::transaction(function () use ($patient, $workItemIds, $doctorId, $discountAmount, $payCashboxId, $payMethod, $appointmentId) {
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
                    'appointment_id' => $appointment->id,
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

                if ($payCashboxId) {
                    $cashbox = Cashbox::findOrFail($payCashboxId);
                    $this->paymentService->collect(
                        patient: $patient,
                        cashbox: $cashbox,
                        amount: (float) $invoice->fresh()->total_amount_ils,
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
                'appointment_id' => $appointment->id,
                'work_items' => $workItems->fresh(['teeth', 'steps.toothSteps', 'steps.serviceStep.fields'])->all(),
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
            if ($completedCount === 0) {
                continue;
            }

            $isDone = $completedCount === $steps->count();
            $wasDoneAlready = ToothFinding::where('patient_id', $workItem->patient_id)
                ->where('tooth_number', $toothNumber)
                ->where('service_id', $workItem->service_id)
                ->where('status', 'done')
                ->exists();

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
    protected function resolveAppointment(Patient $patient, int $doctorId, ?int $appointmentId): Appointment
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

        return Appointment::create([
            'branch_id' => $patient->branch_id,
            'patient_id' => $patient->id,
            'doctor_id' => $doctorId,
            'starts_at' => now(),
            'ends_at' => now()->addMinutes(30),
            'status' => 'done',
            'created_via' => 'web',
        ]);
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

    /** Cancels a work item entirely — only allowed while nothing on it has been billed yet. */
    public function cancel(WorkItem $workItem): void
    {
        $hasBilled = $workItem->toothSteps()->whereNotNull('invoice_line_id')->exists();
        abort_if($hasBilled, 422, 'ما فيك تلغي شغل انحسب منه شي — فيك تلغي بس الأجزاء يلي لسا ما انحسبت.');

        $workItem->update(['status' => 'cancelled']);
    }

    protected function nextInvoiceNumber(): string
    {
        $count = Invoice::withoutGlobalScopes()->count();

        return sprintf('INV-%06d', $count + 1);
    }
}
