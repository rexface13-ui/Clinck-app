<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\PatientTransaction;
use App\Models\PlanItemSession;
use App\Models\TreatmentPlan;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class TreatmentPlanService
{
    /**
     * Approving a plan is final: it stamps approved_at and generates the
     * invoice from the plan's items in one transaction. Both steps happen
     * together or not at all.
     */
    public function approve(TreatmentPlan $plan): Invoice
    {
        abort_if($plan->status !== 'draft', 422, 'الخطة معتمدة أو ملغاة مسبقاً.');

        $plan->loadMissing('items');
        abort_if($plan->items->isEmpty(), 422, 'لا يمكن اعتماد خطة بدون بنود.');

        return DB::transaction(function () use ($plan) {
            $invoice = Invoice::create([
                'clinic_id' => $plan->clinic_id,
                'patient_id' => $plan->patient_id,
                'treatment_plan_id' => $plan->id,
                'invoice_number' => $this->nextInvoiceNumber($plan->clinic_id),
                'status' => 'unpaid',
                'total_amount_ils' => 0,
                'issued_at' => now(),
            ]);

            $total = 0;

            foreach ($plan->items as $item) {
                $exchangeRate = 1; // no live FX source yet; ILS-only in practice
                $lineAmount = $item->unit_price * $item->sessions_count;
                $amountIls = $lineAmount * $exchangeRate;
                $total += $amountIls;

                InvoiceLine::create([
                    'clinic_id' => $plan->clinic_id,
                    'invoice_id' => $invoice->id,
                    'plan_item_id' => $item->id,
                    'description' => $item->service->name.($item->tooth_number ? " (سن {$item->tooth_number})" : ''),
                    'amount' => $lineAmount,
                    'currency' => $item->currency,
                    'exchange_rate' => $exchangeRate,
                    'amount_ils' => $amountIls,
                ]);

                for ($i = 1; $i <= $item->sessions_count; $i++) {
                    PlanItemSession::create([
                        'clinic_id' => $plan->clinic_id,
                        'plan_item_id' => $item->id,
                        'session_number' => $i,
                        'status' => 'pending',
                    ]);
                }
            }

            $invoice->update(['total_amount_ils' => $total]);

            PatientTransaction::create([
                'clinic_id' => $plan->clinic_id,
                'patient_id' => $plan->patient_id,
                'type' => 'charge',
                'reference_type' => 'invoice',
                'reference_id' => $invoice->id,
                'amount' => $total,
                'currency' => 'ILS',
                'exchange_rate' => 1,
                'amount_ils' => $total,
                'occurred_at' => now(),
            ]);

            $plan->update(['status' => 'approved', 'approved_at' => now()]);

            return $invoice->fresh('lines');
        });
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

        $plan->loadMissing(['items.sessions', 'items.service', 'patient']);
        $duration = 30;
        $searchWindowDays = 14;

        DB::transaction(function () use ($plan, $duration, $searchWindowDays) {
            foreach ($plan->items as $item) {
                $intervalDays = $item->service->default_interval_days ?? 7;

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
