<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Cashbox;
use App\Models\CheckModel;
use App\Models\Doctor;
use App\Models\DoctorTransaction;
use App\Models\Invoice;
use App\Models\ItemLot;
use App\Models\Patient;
use App\Models\PatientTransaction;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function summary(Request $request)
    {
        $todayStart = Carbon::today();
        $todayEnd = Carbon::tomorrow();
        $monthStart = Carbon::now()->startOfMonth();

        $todayAppointmentsCount = Appointment::whereBetween('starts_at', [$todayStart, $todayEnd])->count();

        $monthRevenue = (float) Invoice::where('status', '!=', 'cancelled')
            ->whereBetween('issued_at', [$monthStart, Carbon::now()])
            ->sum('total_amount_ils');

        $outstandingBalance = (float) PatientTransaction::sum('amount_ils');

        $unsettledCommissions = (float) DoctorTransaction::whereNull('settled_at')->sum('amount_ils');

        $cashboxesTotal = Cashbox::sum('balance');

        $checksDueSoon = CheckModel::where('status', 'in_wallet')
            ->whereBetween('due_date', [Carbon::today(), Carbon::today()->addDays(7)])
            ->count();

        return response()->json([
            'kpis' => [
                'today_appointments' => $todayAppointmentsCount,
                'month_revenue_ils' => $monthRevenue,
                'outstanding_balance_ils' => $outstandingBalance,
                'unsettled_commissions_ils' => $unsettledCommissions,
                'cashboxes_total' => $cashboxesTotal,
                'checks_due_soon' => $checksDueSoon,
            ],
            'today_appointments' => Appointment::with(['patient:id,full_name', 'doctor:id,full_name'])
                ->whereBetween('starts_at', [$todayStart, $todayEnd])
                ->orderBy('starts_at')
                ->get(['id', 'patient_id', 'doctor_id', 'starts_at', 'status'])
                ->map(fn (Appointment $a) => [
                    'id' => $a->id,
                    'time' => $a->starts_at->format('H:i'),
                    'patient_name' => $a->patient?->full_name,
                    'doctor_name' => $a->doctor?->full_name,
                    'status' => $a->status,
                ]),
            'recent_invoices' => Invoice::with('patient:id,full_name')
                ->orderByDesc('issued_at')
                ->limit(8)
                ->get(['id', 'patient_id', 'invoice_number', 'status', 'total_amount_ils', 'issued_at'])
                ->map(fn (Invoice $i) => [
                    'id' => $i->id,
                    'invoice_number' => $i->invoice_number,
                    'patient_name' => $i->patient?->full_name,
                    'status' => $i->status,
                    'total_amount_ils' => (float) $i->total_amount_ils,
                    'issued_at' => $i->issued_at,
                ]),
            'top_doctors' => DoctorTransaction::select('doctor_id', DB::raw('SUM(amount_ils) as total'))
                ->whereBetween('created_at', [$monthStart, Carbon::now()])
                ->groupBy('doctor_id')
                ->orderByDesc('total')
                ->limit(5)
                ->with('doctor:id,full_name')
                ->get()
                ->map(fn ($row) => [
                    'doctor_name' => $row->doctor?->full_name,
                    'total_ils' => (float) $row->total,
                ]),
            'alerts' => [
                'checks_due' => CheckModel::where('status', 'in_wallet')
                    ->whereBetween('due_date', [Carbon::today(), Carbon::today()->addDays(7)])
                    ->orderBy('due_date')
                    ->limit(5)
                    ->get(['id', 'check_number', 'amount', 'currency', 'due_date']),
                'expiring_lots' => ItemLot::with('item:id,name')
                    ->whereNotNull('expiry_date')
                    ->whereBetween('expiry_date', [Carbon::today(), Carbon::today()->addDays(30)])
                    ->where('quantity_remaining', '>', 0)
                    ->orderBy('expiry_date')
                    ->limit(5)
                    ->get()
                    ->map(fn (ItemLot $lot) => [
                        'item_name' => $lot->item?->name,
                        'lot_number' => $lot->lot_number,
                        'expiry_date' => $lot->expiry_date,
                        'quantity_remaining' => (float) $lot->quantity_remaining,
                    ]),
            ],
        ]);
    }
}
