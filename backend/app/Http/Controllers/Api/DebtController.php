<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Models\PatientTransaction;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DebtController extends Controller
{
    /**
     * Patients with an outstanding balance > 0, sorted highest debt first.
     * Same signed-sum convention as PatientBillingController::ledger().
     */
    public function patients(Request $request)
    {
        abort_unless($request->user()->can('billing.view'), 403);

        $balances = PatientTransaction::select('patient_id', DB::raw("
                SUM(CASE WHEN type IN ('charge','adjustment') THEN amount_ils ELSE -amount_ils END) as balance
            "))
            ->groupBy('patient_id')
            ->havingRaw("SUM(CASE WHEN type IN ('charge','adjustment') THEN amount_ils ELSE -amount_ils END) > 0")
            ->orderByDesc('balance')
            ->get();

        $patients = Patient::whereIn('id', $balances->pluck('patient_id'))
            ->get(['id', 'code', 'full_name', 'phone'])
            ->keyBy('id');

        return $balances->map(fn ($row) => [
            'patient_id' => $row->patient_id,
            'code' => $patients[$row->patient_id]->code ?? null,
            'full_name' => $patients[$row->patient_id]->full_name ?? null,
            'phone' => $patients[$row->patient_id]->phone ?? null,
            'outstanding_ils' => round((float) $row->balance, 2),
        ])->values();
    }
}
