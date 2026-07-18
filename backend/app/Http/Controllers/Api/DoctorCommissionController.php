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
     * Monthly settlement statement: every commission transaction for the
     * given month plus its total, and whether it's already been settled.
     */
    public function index(Request $request, Doctor $doctor)
    {
        abort_unless($request->user()->can('commissions.view'), 403);

        $month = Carbon::parse($request->query('month', now()->format('Y-m-01')))->startOfMonth();

        $transactions = DoctorTransaction::where('doctor_id', $doctor->id)
            ->whereDate('period_month', $month->toDateString())
            ->with('toothFinding.patient')
            ->orderBy('created_at')
            ->get();

        return [
            'doctor' => ['id' => $doctor->id, 'full_name' => $doctor->full_name],
            'month' => $month->format('Y-m'),
            'total_ils' => round($transactions->sum('amount_ils'), 2),
            'settled' => $transactions->isNotEmpty() && $transactions->every(fn ($t) => $t->settled_at !== null),
            'transactions' => $transactions->map(fn ($t) => [
                'id' => $t->id,
                'type' => $t->type,
                'amount_ils' => $t->amount_ils,
                'patient_name' => $t->toothFinding?->patient?->full_name,
                'tooth_number' => $t->toothFinding?->tooth_number,
                'settled_at' => display_date($t->settled_at),
            ]),
        ];
    }

    public function settle(Request $request, Doctor $doctor)
    {
        abort_unless($request->user()->can('commissions.view'), 403);

        $month = Carbon::parse($request->input('month', now()->format('Y-m-01')))->startOfMonth();

        DoctorTransaction::where('doctor_id', $doctor->id)
            ->whereDate('period_month', $month->toDateString())
            ->whereNull('settled_at')
            ->update(['settled_at' => now()]);

        return response()->noContent();
    }
}
