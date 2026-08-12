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
use App\Models\LabCase;
use App\Models\Patient;
use App\Models\PatientTransaction;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function invoices(Request $request)
    {
        abort_unless($request->user()->can('billing.view'), 403);

        $search = trim((string) $request->query('search', ''));

        $query = Invoice::with('patient:id,full_name')
            ->orderByDesc('issued_at')
            ->limit(20);

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->whereHas('patient', fn ($p) => $p->where('full_name', 'like', "%{$search}%"))
                    ->orWhereHas('lines', fn ($l) => $l->where('description', 'like', "%{$search}%"))
                    ->orWhere('invoice_number', 'like', "%{$search}%");
            });
        }

        return response()->json(
            $query->get(['id', 'patient_id', 'invoice_number', 'status', 'total_amount_ils', 'issued_at'])
                ->map(fn (Invoice $i) => [
                    'id' => $i->id,
                    'invoice_number' => $i->invoice_number,
                    'patient_name' => $i->patient?->full_name,
                    'status' => $i->status,
                    'total_amount_ils' => (float) $i->total_amount_ils,
                    'issued_at' => $i->issued_at,
                ]),
        );
    }

    public function summary(Request $request)
    {
        $user = $request->user();
        $canViewCash = $user->can('cash.view');
        $canViewCommissions = $user->can('commissions.view');
        $canViewChecks = $user->can('checks.view');
        $canViewInventory = $user->can('inventory.view');
        $canViewLabCases = $user->can('purchasing.view');
        $canViewFinance = $canViewCash || $canViewCommissions || $canViewChecks;

        // "Today"/"this month" must be computed in the clinic's local timezone,
        // not the server's storage timezone (UTC) — otherwise the boundary
        // hours (e.g. 00:00-03:00 local) fall on the wrong calendar day.
        $timezone = config('dentaflow.display_timezone');
        $todayStart = Carbon::today($timezone)->timezone('UTC');
        $todayEnd = Carbon::tomorrow($timezone)->timezone('UTC');
        $monthStart = Carbon::now($timezone)->startOfMonth()->timezone('UTC');

        $todayAppointmentsCount = Appointment::whereBetween('starts_at', [$todayStart, $todayEnd])->count();

        // 'void' is the actual "cancelled" status on invoices (see Invoice
        // status enum) — a plan that got cancelled voids its invoice, and
        // that must not still count as revenue.
        $monthRevenue = $canViewFinance ? (float) Invoice::where('status', '!=', 'void')
            ->whereBetween('issued_at', [$monthStart, Carbon::now()])
            ->sum('total_amount_ils') : null;

        // Per-patient signed balance (matching PatientBillingController::ledger()
        // and DebtController), summing only positive balances. A single global
        // sum would let one patient's credit (e.g. a refunded/cancelled plan
        // whose payment stays on the books) net against another patient's real
        // debt and hide it.
        $outstandingBalance = $canViewFinance ? (float) PatientTransaction::select(DB::raw(
            "SUM(CASE WHEN type IN ('charge','adjustment') THEN amount_ils ELSE -amount_ils END) as balance"
        ))
            ->groupBy('patient_id')
            ->havingRaw("SUM(CASE WHEN type IN ('charge','adjustment') THEN amount_ils ELSE -amount_ils END) > 0")
            ->get()
            ->sum('balance') : null;

        $unsettledCommissions = $canViewCommissions ? (float) DoctorTransaction::whereNull('settled_at')->sum('amount_ils') : null;

        $cashboxesTotal = $canViewCash ? Cashbox::sum('balance') : null;

        $checksDueSoon = $canViewChecks ? CheckModel::where('status', 'in_wallet')
            ->whereBetween('due_date', [Carbon::today($timezone), Carbon::today($timezone)->addDays(7)])
            ->count() : null;

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
                    'patient_id' => $a->patient_id,
                    'doctor_id' => $a->doctor_id,
                    // Raw ISO — the frontend converts to the display timezone via
                    // lib/formatDate.ts, same as everywhere else. Pre-formatting
                    // "H:i" here used the app's storage timezone (UTC) instead of
                    // the clinic's display timezone, so it disagreed with the
                    // appointments page whenever those differ.
                    'starts_at' => $a->starts_at->toIso8601String(),
                    'patient_name' => $a->patient?->full_name,
                    'doctor_name' => $a->doctor?->full_name,
                    'status' => $a->status,
                ]),
            'recent_invoices' => $canViewFinance ? Invoice::with('patient:id,full_name')
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
                ]) : [],
            'top_doctors' => $canViewCommissions ? DoctorTransaction::select('doctor_id', DB::raw('SUM(amount_ils) as total'))
                ->whereBetween('created_at', [$monthStart, Carbon::now()])
                ->groupBy('doctor_id')
                ->orderByDesc('total')
                ->limit(5)
                ->with('doctor:id,full_name')
                ->get()
                ->map(fn ($row) => [
                    'doctor_name' => $row->doctor?->full_name,
                    'total_ils' => (float) $row->total,
                ]) : [],
            'alerts' => [
                'checks_due' => $canViewChecks ? CheckModel::with('party')
                    ->where('status', 'in_wallet')
                    ->whereBetween('due_date', [Carbon::today($timezone), Carbon::today($timezone)->addDays(7)])
                    ->orderBy('due_date')
                    ->limit(5)
                    ->get(['id', 'direction', 'party_type', 'party_id', 'check_number', 'bank_name', 'amount', 'currency', 'due_date'])
                    ->map(fn (CheckModel $c) => [
                        'id' => $c->id,
                        'direction' => $c->direction,
                        'check_number' => $c->check_number,
                        'bank_name' => $c->bank_name,
                        'party_name' => $c->party?->full_name ?? $c->party?->name,
                        'amount' => (float) $c->amount,
                        'currency' => $c->currency,
                        'due_date' => $c->due_date,
                    ]) : [],
                'expiring_lots' => $canViewInventory ? ItemLot::with('item:id,name')
                    ->whereNotNull('expiry_date')
                    ->whereBetween('expiry_date', [Carbon::today($timezone), Carbon::today($timezone)->addDays(30)])
                    ->where('quantity_remaining', '>', 0)
                    ->orderBy('expiry_date')
                    ->limit(5)
                    ->get()
                    ->map(fn (ItemLot $lot) => [
                        'item_name' => $lot->item?->name,
                        'lot_number' => $lot->lot_number,
                        'expiry_date' => $lot->expiry_date,
                        'quantity_remaining' => (float) $lot->quantity_remaining,
                    ]) : [],
                'lab_cases_due' => $canViewLabCases ? LabCase::with(['patient:id,full_name', 'supplier:id,name'])
                    ->where('status', '!=', 'received')
                    ->where('expected_return_date', '<=', Carbon::today($timezone))
                    ->orderBy('expected_return_date')
                    ->limit(5)
                    ->get()
                    ->map(fn (LabCase $c) => [
                        'id' => $c->id,
                        'patient_name' => $c->patient?->full_name,
                        'supplier_name' => $c->supplier?->name,
                        'description' => $c->description,
                        'expected_return_date' => $c->expected_return_date,
                        'status' => $c->status,
                    ]) : [],
            ],
        ]);
    }
}
