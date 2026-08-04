<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\CheckModel;
use App\Models\Doctor;
use App\Models\DoctorTransaction;
use App\Models\Expense;
use App\Models\InvoiceLine;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Models\Supplier;
use App\Models\SupplierTransaction;
use App\Models\WorkItem;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class ReportController extends Controller
{
    protected function authorizeView(Request $request): void
    {
        abort_unless($request->user()->can('reports.view'), 403);
    }

    /**
     * Monthly revenue (patient charges) for the last N months, oldest first,
     * so the frontend can draw a simple bar chart and read the last two
     * entries for a month-over-month comparison.
     */
    public function revenue(Request $request)
    {
        $this->authorizeView($request);

        $months = (int) $request->input('months', 6);
        $timezone = config('dentaflow.display_timezone');
        $start = Carbon::now($timezone)->subMonths($months - 1)->startOfMonth();

        $rows = PatientTransaction::where('type', 'charge')
            ->where('occurred_at', '>=', $start->clone()->timezone('UTC'))
            ->get(['amount_ils', 'occurred_at']);

        $byMonth = [];
        for ($i = 0; $i < $months; $i++) {
            $m = $start->clone()->addMonths($i);
            $byMonth[$m->format('Y-m')] = ['month' => $m->format('Y-m'), 'label' => $m->translatedFormat('M Y'), 'total_ils' => 0.0];
        }

        foreach ($rows as $row) {
            $key = Carbon::parse($row->occurred_at)->timezone($timezone)->format('Y-m');
            if (isset($byMonth[$key])) {
                $byMonth[$key]['total_ils'] += (float) $row->amount_ils;
            }
        }

        return ['months' => array_values($byMonth)];
    }

    /** Revenue by service (from invoice lines) within a date range. */
    public function revenueByService(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $query = InvoiceLine::with('workItemToothStep.workItem.service')
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'));

        $totals = [];
        foreach ($query->get() as $line) {
            $name = $line->workItemToothStep?->workItem?->service?->name ?? 'أخرى';
            $totals[$name] = ($totals[$name] ?? 0) + (float) $line->amount_ils;
        }

        arsort($totals);

        return ['services' => collect($totals)->map(fn ($total, $name) => ['service_name' => $name, 'total_ils' => $total])->values()];
    }

    /** Per-doctor production: revenue attributed to their treatment plans + commission paid, within range. */
    public function doctorProductivity(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $doctors = Doctor::where('is_active', true)->get();

        $result = $doctors->map(function (Doctor $doctor) use ($data) {
            $revenue = InvoiceLine::whereHas('workItemToothStep.workItem', fn ($q) => $q->where('doctor_id', $doctor->id))
                ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
                ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
                ->sum('amount_ils');

            // A "session" is one work item (one visit's worth of work), which
            // can span several teeth/steps and therefore several invoice
            // lines — count distinct work items, not invoice lines, so a
            // single multi-tooth visit isn't counted as several sessions.
            $sessionsCount = InvoiceLine::whereHas('workItemToothStep.workItem', fn ($q) => $q->where('doctor_id', $doctor->id))
                ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
                ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
                ->join('work_item_tooth_steps', 'invoice_lines.work_item_tooth_step_id', '=', 'work_item_tooth_steps.id')
                ->distinct('work_item_tooth_steps.work_item_id')
                ->count('work_item_tooth_steps.work_item_id');

            $commission = DoctorTransaction::where('doctor_id', $doctor->id)
                ->where('type', 'commission')
                ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
                ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
                ->sum('amount_ils');

            // "Paid" is filtered by settled_at (when the payout actually
            // happened), not created_at, since a settlement can be recorded
            // any time after the commission itself was earned.
            $commissionPaid = DoctorTransaction::where('doctor_id', $doctor->id)
                ->where('type', 'settlement')
                ->when($data['from'] ?? null, fn ($q, $from) => $q->where('settled_at', '>=', $from))
                ->when($data['to'] ?? null, fn ($q, $to) => $q->where('settled_at', '<=', $to.' 23:59:59'))
                ->sum('amount_ils');

            return [
                'doctor_id' => $doctor->id,
                'doctor_name' => $doctor->full_name,
                'sessions_count' => $sessionsCount,
                'revenue_ils' => (float) $revenue,
                'commission_ils' => (float) $commission,
                'commission_paid_ils' => (float) $commissionPaid,
                'commission_outstanding_ils' => round((float) $commission - (float) $commissionPaid, 2),
            ];
        })->sortByDesc('revenue_ils')->values();

        return ['doctors' => $result];
    }

    /** New patients (registered) vs returning (had a done visit before that month) per month. */
    public function patients(Request $request)
    {
        $this->authorizeView($request);

        $months = (int) $request->input('months', 6);
        $timezone = config('dentaflow.display_timezone');
        $start = Carbon::now($timezone)->subMonths($months - 1)->startOfMonth();

        $allPatients = Patient::all(['id', 'created_at']);
        $doneAppointments = Appointment::where('status', 'done')->get(['patient_id', 'starts_at']);

        $monthsOut = [];
        for ($i = 0; $i < $months; $i++) {
            $m = $start->clone()->addMonths($i);
            $monthStart = $m->clone()->startOfMonth();
            $monthEnd = $m->clone()->endOfMonth();

            $newCount = $allPatients->filter(
                fn ($p) => Carbon::parse($p->created_at)->timezone($timezone)->between($monthStart, $monthEnd)
            )->count();

            $visitedThisMonth = $doneAppointments->filter(
                fn ($a) => Carbon::parse($a->starts_at)->timezone($timezone)->between($monthStart, $monthEnd)
            )->pluck('patient_id')->unique();

            $returningCount = $visitedThisMonth->filter(function ($patientId) use ($allPatients, $monthStart) {
                $p = $allPatients->firstWhere('id', $patientId);

                return $p && Carbon::parse($p->created_at)->lt($monthStart);
            })->count();

            $monthsOut[] = [
                'month' => $monthStart->format('Y-m'),
                'label' => $monthStart->translatedFormat('M Y'),
                'new_patients' => $newCount,
                'returning_patients' => $returningCount,
            ];
        }

        return ['months' => $monthsOut];
    }

    /** No-show rate: no_show / (done + no_show) within range, overall and per doctor. */
    public function noShow(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $query = Appointment::whereIn('status', ['done', 'no_show'])
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('starts_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('starts_at', '<=', $to.' 23:59:59'));

        $rows = $query->get(['status', 'doctor_id']);

        $overallTotal = $rows->count();
        $overallNoShow = $rows->where('status', 'no_show')->count();

        $byDoctor = $rows->groupBy('doctor_id')->map(function ($group, $doctorId) {
            $total = $group->count();
            $noShow = $group->where('status', 'no_show')->count();

            return [
                'doctor_id' => $doctorId,
                'total' => $total,
                'no_show' => $noShow,
                'rate' => $total > 0 ? round($noShow / $total * 100, 1) : 0,
            ];
        })->values();

        $doctorNames = Doctor::whereIn('id', $byDoctor->pluck('doctor_id')->filter())->pluck('full_name', 'id');

        return [
            'overall' => [
                'total' => $overallTotal,
                'no_show' => $overallNoShow,
                'rate' => $overallTotal > 0 ? round($overallNoShow / $overallTotal * 100, 1) : 0,
            ],
            'by_doctor' => $byDoctor->map(fn ($row) => [
                ...$row,
                'doctor_name' => $row['doctor_id'] ? ($doctorNames[$row['doctor_id']] ?? 'غير محدد') : 'بدون طبيب محدد',
            ]),
        ];
    }

    /**
     * Debt aging — buckets each patient with a positive outstanding balance
     * by days since their oldest still-relevant charge. An approximation
     * (not strict FIFO allocation of payments against specific charges),
     * good enough to flag who's been owing the longest.
     */
    public function debtsAging(Request $request)
    {
        $this->authorizeView($request);

        $timezone = config('dentaflow.display_timezone');
        $now = Carbon::now($timezone);

        $patients = Patient::with(['transactions' => fn ($q) => $q->orderBy('occurred_at')])->get();

        $buckets = ['0-30' => [], '31-60' => [], '61-90' => [], '90+' => []];

        foreach ($patients as $patient) {
            $balance = $patient->transactions->reduce(
                fn ($carry, $t) => $carry + (in_array($t->type, ['charge', 'adjustment'], true) ? (float) $t->amount_ils : -(float) $t->amount_ils),
                0.0
            );

            if ($balance <= 0.01) {
                continue;
            }

            $oldestCharge = $patient->transactions->firstWhere('type', 'charge');
            $days = $oldestCharge ? (int) Carbon::parse($oldestCharge->occurred_at)->diffInDays($now) : 0;

            $bucket = $days <= 30 ? '0-30' : ($days <= 60 ? '31-60' : ($days <= 90 ? '61-90' : '90+'));
            $buckets[$bucket][] = [
                'patient_id' => $patient->id,
                'patient_name' => $patient->full_name,
                'balance_ils' => round($balance, 2),
                'days' => $days,
            ];
        }

        return [
            'buckets' => collect($buckets)->map(fn ($patients, $key) => [
                'bucket' => $key,
                'patients_count' => count($patients),
                'total_ils' => round(collect($patients)->sum('balance_ils'), 2),
                'patients' => collect($patients)->sortByDesc('balance_ils')->values(),
            ])->values(),
        ];
    }

    /** Collections broken down by payment method within a date range. */
    public function collections(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $rows = Payment::when($data['from'] ?? null, fn ($q, $from) => $q->where('paid_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('paid_at', '<=', $to.' 23:59:59'))
            ->get(['method', 'amount_ils']);

        $labels = ['cash' => 'نقدي', 'card' => 'بطاقة', 'transfer' => 'تحويل', 'check' => 'شيك'];
        $totals = [];
        foreach ($rows as $row) {
            $totals[$row->method] = ($totals[$row->method] ?? 0) + (float) $row->amount_ils;
        }

        return [
            'methods' => collect($totals)->map(fn ($total, $method) => [
                'method' => $method,
                'label' => $labels[$method] ?? $method,
                'total_ils' => $total,
            ])->values(),
        ];
    }

    /**
     * Patients with unfinished dental work: any work item still "in_progress"
     * (at least one tooth-step not yet completed). Covers both "never
     * touched" work and work where a past visit finished some teeth but
     * left others still needing a step done.
     */
    public function pendingTreatments(Request $request)
    {
        $this->authorizeView($request);

        $workItems = WorkItem::where('status', 'in_progress')
            ->with(['service', 'patient', 'doctor', 'toothSteps'])
            ->get();

        $byPatient = [];
        foreach ($workItems as $workItem) {
            $remaining = $workItem->toothSteps->whereNull('completed_at')->pluck('tooth_number')->unique()->values()->all();
            if (empty($remaining)) {
                continue;
            }

            $patient = $workItem->patient;
            if (! $patient) {
                continue;
            }

            $byPatient[$patient->id] ??= [
                'patient_id' => $patient->id,
                'patient_name' => $patient->full_name,
                'phone' => $patient->phone,
                'items' => [],
            ];

            $byPatient[$patient->id]['items'][] = [
                'plan_id' => $workItem->id,
                'service_name' => $workItem->service->name ?? 'خدمة',
                'doctor_name' => $workItem->doctor->full_name ?? null,
                'remaining_teeth' => array_map('intval', $remaining),
            ];
        }

        return ['patients' => array_values($byPatient)];
    }

    /**
     * Per-cashbox live balance + money in/out within the range, plus
     * expenses broken down by category within the same range. The balance
     * itself is always "right now" (a cashbox has one real balance); only
     * the flow and expense figures respect the date filter.
     */
    public function cashboxFlow(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $cashboxes = Cashbox::orderBy('name')->get();

        $flows = CashboxTransaction::whereIn('cashbox_id', $cashboxes->pluck('id'))
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('occurred_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('occurred_at', '<=', $to.' 23:59:59'))
            ->get(['cashbox_id', 'amount']);

        $cashboxesOut = $cashboxes->map(function (Cashbox $c) use ($flows) {
            $rows = $flows->where('cashbox_id', $c->id);

            return [
                'cashbox_id' => $c->id,
                'name' => $c->name,
                'currency' => $c->currency,
                'balance' => (float) $c->balance,
                'total_in' => round((float) $rows->filter(fn ($r) => $r->amount > 0)->sum('amount'), 2),
                'total_out' => round((float) $rows->filter(fn ($r) => $r->amount < 0)->sum('amount'), 2),
            ];
        })->values();

        $expenseRows = Expense::with('category')
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('spent_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('spent_at', '<=', $to.' 23:59:59'))
            ->get();

        $byCategory = [];
        foreach ($expenseRows as $expense) {
            $name = $expense->category?->name ?? 'أخرى';
            $byCategory[$name] = ($byCategory[$name] ?? 0) + (float) $expense->amount_ils;
        }
        arsort($byCategory);

        return [
            'cashboxes' => $cashboxesOut,
            'expenses' => [
                'total_ils' => round(array_sum($byCategory), 2),
                'by_category' => collect($byCategory)->map(fn ($total, $name) => ['category' => $name, 'total_ils' => round($total, 2)])->values(),
            ],
        ];
    }

    /**
     * Money owed to suppliers + purchase invoices still outstanding, plus
     * checks that need attention soon (due within 14 days, or already
     * overdue/bounced) — the two things a clinic owner actually watches on
     * the outgoing-money side.
     */
    public function suppliersChecks(Request $request)
    {
        $this->authorizeView($request);

        $balances = SupplierTransaction::selectRaw('supplier_id, SUM(amount_ils) as total')
            ->groupBy('supplier_id')
            ->pluck('total', 'supplier_id');

        $suppliers = Supplier::whereIn('id', $balances->keys())
            ->get()
            ->map(fn (Supplier $s) => [
                'supplier_id' => $s->id,
                'supplier_name' => $s->name,
                'outstanding_ils' => round((float) ($balances[$s->id] ?? 0), 2),
            ])
            ->filter(fn ($s) => $s['outstanding_ils'] > 0.01)
            ->sortByDesc('outstanding_ils')
            ->values();

        $timezone = config('dentaflow.display_timezone');
        $now = Carbon::now($timezone);
        $soon = $now->clone()->addDays(14);

        $dueSoon = CheckModel::whereIn('status', ['in_wallet', 'endorsed'])
            ->whereDate('due_date', '<=', $soon)
            ->with('party')
            ->orderBy('due_date')
            ->get()
            ->map(fn (CheckModel $c) => [
                'id' => $c->id,
                'direction' => $c->direction,
                'check_number' => $c->check_number,
                'bank_name' => $c->bank_name,
                'amount' => (float) $c->amount,
                'currency' => $c->currency,
                'due_date' => display_datetime($c->due_date),
                'is_overdue' => Carbon::parse($c->due_date)->lt($now->startOfDay()),
                'party_name' => $c->party?->name ?? $c->party?->full_name,
            ]);

        $bounced = CheckModel::where('status', 'bounced')
            ->with('party')
            ->orderByDesc('due_date')
            ->get()
            ->map(fn (CheckModel $c) => [
                'id' => $c->id,
                'direction' => $c->direction,
                'check_number' => $c->check_number,
                'bank_name' => $c->bank_name,
                'amount' => (float) $c->amount,
                'currency' => $c->currency,
                'due_date' => display_datetime($c->due_date),
                'party_name' => $c->party?->name ?? $c->party?->full_name,
            ]);

        return [
            'suppliers' => $suppliers,
            'suppliers_total_ils' => round($suppliers->sum('outstanding_ils'), 2),
            'checks_due_soon' => $dueSoon->values(),
            'checks_bounced' => $bounced->values(),
        ];
    }

    /**
     * Small top-of-page indicator: revenue minus doctor commissions minus
     * expenses within the range — an approximate net profit, not a strict
     * accounting P&L (doesn't account for e.g. accrual timing or
     * uncollected receivables).
     */
    public function summary(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $revenue = PatientTransaction::where('type', 'charge')
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('occurred_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('occurred_at', '<=', $to.' 23:59:59'))
            ->sum('amount_ils');

        $commissions = DoctorTransaction::where('type', 'commission')
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
            ->sum('amount_ils');

        $expenses = Expense::when($data['from'] ?? null, fn ($q, $from) => $q->where('spent_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('spent_at', '<=', $to.' 23:59:59'))
            ->sum('amount_ils');

        return [
            'revenue_ils' => round((float) $revenue, 2),
            'commissions_ils' => round((float) $commissions, 2),
            'expenses_ils' => round((float) $expenses, 2),
            'net_profit_ils' => round((float) $revenue - (float) $commissions - (float) $expenses, 2),
        ];
    }
}
