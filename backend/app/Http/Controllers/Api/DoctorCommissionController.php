<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Doctor;
use App\Models\DoctorTransaction;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class DoctorCommissionController extends Controller
{
    /**
     * Monthly HR statement for a doctor: every commission earned this month
     * (with the session/service that generated it), the flat monthly salary
     * if their contract includes one, every payout already made against
     * this month (with whatever note was left on it), and what's still owed.
     */
    public function index(Request $request, Doctor $doctor)
    {
        abort_unless($request->user()->can('commissions.view'), 403);

        $month = Carbon::parse($request->query('month', now()->format('Y-m-01')))->startOfMonth();

        $commissionTransactions = DoctorTransaction::where('doctor_id', $doctor->id)
            ->where('type', 'commission')
            ->whereDate('period_month', $month->toDateString())
            ->with(['toothFinding.patient', 'toothFinding.service'])
            ->orderBy('created_at')
            ->get();

        $payouts = DoctorTransaction::where('doctor_id', $doctor->id)
            ->where('type', 'settlement')
            ->whereDate('period_month', $month->toDateString())
            ->orderByDesc('settled_at')
            ->get();

        $commissionTotal = round($commissionTransactions->sum('amount_ils'), 2);
        $salaryDue = in_array($doctor->contract_type, ['salary', 'salary_commission'], true)
            ? (float) ($doctor->monthly_salary ?? 0)
            : 0.0;
        $totalDue = round($commissionTotal + $salaryDue, 2);
        $paidTotal = round($payouts->sum('amount_ils'), 2);

        return [
            'doctor' => ['id' => $doctor->id, 'full_name' => $doctor->full_name, 'contract_type' => $doctor->contract_type],
            'month' => $month->format('Y-m'),
            'commission_total_ils' => $commissionTotal,
            'salary_due_ils' => $salaryDue,
            'total_due_ils' => $totalDue,
            'paid_ils' => $paidTotal,
            'remaining_ils' => round($totalDue - $paidTotal, 2),
            'transactions' => $commissionTransactions->map(fn (DoctorTransaction $t) => [
                'id' => $t->id,
                'amount_ils' => $t->amount_ils,
                'patient_name' => $t->toothFinding?->patient?->full_name,
                'tooth_number' => $t->toothFinding?->tooth_number,
                'service_name' => $t->toothFinding?->service?->name,
                'finding_type' => $t->toothFinding?->finding_type,
                'recorded_at' => display_datetime($t->toothFinding?->recorded_at),
            ]),
            'payouts' => $payouts->map(fn (DoctorTransaction $t) => [
                'id' => $t->id,
                'amount_ils' => $t->amount_ils,
                'notes' => $t->notes,
                'paid_at' => display_datetime($t->settled_at),
            ]),
        ];
    }

    /**
     * Record a payout against this month's due amount — full or partial,
     * with an optional note. Doesn't clamp to the remaining balance: paying
     * more than what's due is allowed and simply shows as a negative
     * "remaining" (a credit carried into the conversation with the doctor,
     * not silently rejected).
     */
    public function pay(Request $request, Doctor $doctor)
    {
        abort_unless($request->user()->can('commissions.view'), 403);

        $data = $request->validate([
            'month' => ['required', 'date'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $month = Carbon::parse($data['month'])->startOfMonth();

        DoctorTransaction::create([
            'clinic_id' => $doctor->clinic_id,
            'doctor_id' => $doctor->id,
            'type' => 'settlement',
            'amount_ils' => $data['amount'],
            'period_month' => $month->toDateString(),
            'settled_at' => now(),
            'notes' => $data['notes'] ?? null,
        ]);

        return response()->noContent();
    }
}
