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
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Models\Supplier;
use App\Models\SupplierTransaction;
use App\Models\WorkItem;
use App\Support\SessionLabel;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class ReportController extends Controller
{
    protected function authorizeView(Request $request): void
    {
        abort_unless($request->user()->can('reports.view'), 403);
    }

    /**
     * Builds N consecutive periods (day/week/month), oldest first, ending at
     * the current one — the shared time-bucketing used by every "بحسب
     * الفترة" chart (revenue, sessions...) so a day/week/month toggle means
     * the same thing everywhere. Weeks run Saturday→Friday (the clinic's own
     * work week), not the ISO Sunday-start one.
     */
    private function periodRanges(string $granularity, int $count, string $timezone): array
    {
        $now = Carbon::now($timezone);
        $periods = [];

        if ($granularity === 'daily') {
            $start = $now->clone()->subDays($count - 1)->startOfDay();
            for ($i = 0; $i < $count; $i++) {
                $day = $start->clone()->addDays($i);
                $periods[] = ['key' => $day->format('Y-m-d'), 'label' => $day->translatedFormat('D d/m'), 'start' => $day->clone(), 'end' => $day->clone()->endOfDay()];
            }
        } elseif ($granularity === 'weekly') {
            $start = $now->clone()->startOfWeek(Carbon::SATURDAY)->subWeeks($count - 1)->startOfDay();
            for ($i = 0; $i < $count; $i++) {
                $weekStart = $start->clone()->addWeeks($i);
                $weekEnd = $weekStart->clone()->addDays(6)->endOfDay();
                $periods[] = [
                    'key' => $weekStart->format('Y-m-d'),
                    'label' => $weekStart->format('d/m').'-'.$weekEnd->format('d/m'),
                    'start' => $weekStart,
                    'end' => $weekEnd,
                ];
            }
        } else {
            $start = $now->clone()->subMonths($count - 1)->startOfMonth();
            for ($i = 0; $i < $count; $i++) {
                $month = $start->clone()->addMonths($i);
                $periods[] = [
                    'key' => $month->format('Y-m'),
                    'label' => $month->translatedFormat('M Y'),
                    'start' => $month->clone(),
                    'end' => $month->clone()->endOfMonth(),
                ];
            }
        }

        return $periods;
    }

    /**
     * Revenue (patient charges) bucketed into day/week/month periods, oldest
     * first, so the frontend can draw a bar chart and read the last two
     * entries for a period-over-period comparison.
     */
    public function revenue(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate(['granularity' => ['nullable', 'in:daily,weekly,monthly'], 'count' => ['nullable', 'integer', 'min:1', 'max:60']]);
        $granularity = $data['granularity'] ?? 'monthly';
        $defaultCount = ['daily' => 14, 'weekly' => 8, 'monthly' => 6][$granularity];
        $count = $data['count'] ?? (int) $request->input('months', $defaultCount);

        $timezone = config('dentaflow.display_timezone');
        $periods = $this->periodRanges($granularity, $count, $timezone);

        $rangeStart = $periods[0]['start']->clone()->timezone('UTC');

        // Charges AND adjustments together — adjustments are the discounts,
        // reversals and price corrections, all stored negative. Summing only
        // the charges reported list price as if nothing was ever discounted,
        // which overstated revenue by the full value of every discount given.
        $rows = PatientTransaction::revenue()
            ->where('occurred_at', '>=', $rangeStart)
            ->get(['amount_ils', 'occurred_at']);

        foreach ($periods as &$period) {
            $period['total_ils'] = 0.0;
        }
        unset($period);

        foreach ($rows as $row) {
            $occurredAt = Carbon::parse($row->occurred_at)->timezone($timezone);
            foreach ($periods as &$period) {
                if ($occurredAt->between($period['start'], $period['end'])) {
                    $period['total_ils'] += (float) $row->amount_ils;
                    break;
                }
            }
            unset($period);
        }

        $out = array_map(fn ($p) => [
            'key' => $p['key'],
            'label' => $p['label'],
            'from' => $p['start']->format('Y-m-d'),
            'to' => $p['end']->format('Y-m-d'),
            'total_ils' => round($p['total_ils'], 2),
        ], $periods);

        return ['granularity' => $granularity, 'periods' => $out, 'months' => $out];
    }

    /**
     * Total session count (distinct work items across all active doctors)
     * bucketed into day/week/month periods — the "جلسات" companion chart to
     * revenue(), same period semantics. Clicking a bar on the frontend
     * re-filters the existing per-doctor productivity table to that period's
     * date range instead of duplicating the breakdown here.
     */
    public function sessionsByPeriod(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate(['granularity' => ['nullable', 'in:daily,weekly,monthly'], 'count' => ['nullable', 'integer', 'min:1', 'max:60']]);
        $granularity = $data['granularity'] ?? 'monthly';
        $defaultCount = ['daily' => 14, 'weekly' => 8, 'monthly' => 6][$granularity];
        $count = $data['count'] ?? $defaultCount;

        $timezone = config('dentaflow.display_timezone');
        $periods = $this->periodRanges($granularity, $count, $timezone);

        $out = [];
        foreach ($periods as $period) {
            $sessionsCount = InvoiceLine::whereHas('workItemToothStep.workItem')
                ->where('invoice_lines.created_at', '>=', $period['start']->clone()->timezone('UTC'))
                ->where('invoice_lines.created_at', '<=', $period['end']->clone()->timezone('UTC'))
                ->join('work_item_tooth_steps', 'invoice_lines.work_item_tooth_step_id', '=', 'work_item_tooth_steps.id')
                ->distinct('work_item_tooth_steps.work_item_id')
                ->count('work_item_tooth_steps.work_item_id');

            $out[] = [
                'key' => $period['key'],
                'label' => $period['label'],
                'from' => $period['start']->format('Y-m-d'),
                'to' => $period['end']->format('Y-m-d'),
                'sessions_count' => $sessionsCount,
            ];
        }

        return ['granularity' => $granularity, 'periods' => $out];
    }

    /**
     * A line keeps its full list price even after the invoice it sits on was
     * discounted, so summing lines straight credits services and doctors with
     * money the clinic never earned. Scale each line by its invoice's
     * discount ratio, and hand the leftover cent(s) of rounding to the
     * invoice's largest line so the parts always add back to the invoice's
     * real total.
     *
     * @param  \Illuminate\Support\Collection<int, InvoiceLine>  $lines  each with invoice.lines loaded
     * @return array<int, float> line id => net amount
     */
    private function netLineAmounts($lines): array
    {
        $net = [];
        $done = [];

        foreach ($lines as $line) {
            $invoice = $line->invoice;
            if (! $invoice) {
                $net[$line->id] = (float) $line->amount_ils;

                continue;
            }
            if (isset($done[$invoice->id])) {
                continue;
            }
            $done[$invoice->id] = true;

            $all = $invoice->lines;
            $listTotal = (float) $all->sum('amount_ils');
            $ratio = $listTotal > 0 ? (float) $invoice->total_amount_ils / $listTotal : 1.0;

            $invoiceNet = [];
            foreach ($all as $l) {
                $invoiceNet[$l->id] = round((float) $l->amount_ils * $ratio, 2);
            }
            if ($listTotal > 0 && $invoiceNet) {
                $drift = round((float) $invoice->total_amount_ils - array_sum($invoiceNet), 2);
                if (abs($drift) > 0 && abs($drift) < 0.1) {
                    $largest = $all->sortByDesc('amount_ils')->first()->id;
                    $invoiceNet[$largest] = round($invoiceNet[$largest] + $drift, 2);
                }
            }
            foreach ($invoiceNet as $id => $amount) {
                $net[$id] = $amount;
            }
        }

        return $net;
    }

    /**
     * Converts a plain "من/إلى" date pair (as the clinic's own local day,
     * e.g. "2026-09-29") into UTC instants for filtering timestamp columns.
     * Several reports used to compare a local calendar date directly against
     * UTC-stored timestamps — fine at noon, but a charge or payment recorded
     * late at night could land on the wrong side of midnight once converted
     * to the clinic's real timezone, making two reports over "the same" date
     * range disagree by a transaction or two. Every date-ranged report should
     * go through this instead of comparing raw strings.
     */
    private function localDateBounds(?string $from, ?string $to): array
    {
        $timezone = config('dentaflow.display_timezone');

        return [
            $from ? Carbon::parse($from, $timezone)->startOfDay()->timezone('UTC') : null,
            $to ? Carbon::parse($to, $timezone)->endOfDay()->timezone('UTC') : null,
        ];
    }

    /** Revenue by service (from invoice lines) within a date range. */
    public function revenueByService(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        [$from, $to] = $this->localDateBounds($data['from'] ?? null, $data['to'] ?? null);

        $lines = InvoiceLine::with(['workItemToothStep.workItem.service', 'invoice.lines'])
            ->when($from, fn ($q, $v) => $q->where('invoice_lines.created_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('invoice_lines.created_at', '<=', $v))
            ->get();

        $net = $this->netLineAmounts($lines);

        $totals = [];
        foreach ($lines as $line) {
            $name = $line->workItemToothStep?->workItem?->service?->name ?? 'أخرى';
            $totals[$name] = round(($totals[$name] ?? 0) + $net[$line->id], 2);
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

        [$from, $to] = $this->localDateBounds($data['from'] ?? null, $data['to'] ?? null);

        $doctors = Doctor::where('is_active', true)->get();

        $result = $doctors->map(function (Doctor $doctor) use ($from, $to) {
            // Net of invoice discounts, same as revenueByService — summing the
            // raw line prices credited a doctor with money never collected
            // and made the doctors' revenue disagree with every other report.
            $doctorLines = InvoiceLine::with('invoice.lines')
                ->whereHas('workItemToothStep.workItem', fn ($q) => $q->where('doctor_id', $doctor->id))
                ->when($from, fn ($q, $v) => $q->where('created_at', '>=', $v))
                ->when($to, fn ($q, $v) => $q->where('created_at', '<=', $v))
                ->get();
            $net = $this->netLineAmounts($doctorLines);
            $revenue = round($doctorLines->sum(fn ($l) => $net[$l->id]), 2);

            // A "session" is one work item (one visit's worth of work), which
            // can span several teeth/steps and therefore several invoice
            // lines — count distinct work items, not invoice lines, so a
            // single multi-tooth visit isn't counted as several sessions.
            $sessionsCount = InvoiceLine::whereHas('workItemToothStep.workItem', fn ($q) => $q->where('doctor_id', $doctor->id))
                ->when($from, fn ($q, $v) => $q->where('created_at', '>=', $v))
                ->when($to, fn ($q, $v) => $q->where('created_at', '<=', $v))
                ->join('work_item_tooth_steps', 'invoice_lines.work_item_tooth_step_id', '=', 'work_item_tooth_steps.id')
                ->distinct('work_item_tooth_steps.work_item_id')
                ->count('work_item_tooth_steps.work_item_id');

            $commission = DoctorTransaction::where('doctor_id', $doctor->id)
                ->where('type', 'commission')
                ->when($from, fn ($q, $v) => $q->where('created_at', '>=', $v))
                ->when($to, fn ($q, $v) => $q->where('created_at', '<=', $v))
                ->sum('amount_ils');

            // "Paid" is filtered by settled_at (when the payout actually
            // happened), not created_at, since a settlement can be recorded
            // any time after the commission itself was earned.
            $commissionPaid = DoctorTransaction::where('doctor_id', $doctor->id)
                ->where('type', 'settlement')
                ->when($from, fn ($q, $v) => $q->where('settled_at', '>=', $v))
                ->when($to, fn ($q, $v) => $q->where('settled_at', '<=', $v))
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

        [$from, $to] = $this->localDateBounds($data['from'] ?? null, $data['to'] ?? null);

        $query = Appointment::whereIn('status', ['done', 'no_show'])
            ->when($from, fn ($q, $v) => $q->where('starts_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('starts_at', '<=', $v));

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

        [$from, $to] = $this->localDateBounds($data['from'] ?? null, $data['to'] ?? null);

        $rows = Payment::when($from, fn ($q, $v) => $q->where('paid_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('paid_at', '<=', $v))
            ->get(['method', 'amount_ils']);

        $labels = ['cash' => 'نقدي', 'card' => 'بطاقة', 'transfer' => 'تحويل', 'check' => 'شيك'];
        $totals = [];
        foreach ($rows as $row) {
            $totals[$row->method] = ($totals[$row->method] ?? 0) + (float) $row->amount_ils;
        }

        // Patient checks never go through the payments table (they mustn't
        // credit a cashbox before they clear), so counting only payments hid
        // every shekel collected by check — the "شيك" label existed here but
        // could never appear. Count them from the checks themselves.
        $checksTotal = (float) CheckModel::where('direction', 'incoming')
            ->where('party_type', 'patient')
            ->where('status', '!=', 'bounced')
            ->when($from, fn ($q, $v) => $q->where('received_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('received_at', '<=', $v))
            ->sum('amount');

        if ($checksTotal > 0) {
            $totals['check'] = ($totals['check'] ?? 0) + $checksTotal;
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

        [$from, $to] = $this->localDateBounds($data['from'] ?? null, $data['to'] ?? null);

        $cashboxes = Cashbox::orderBy('name')->get();

        $flows = CashboxTransaction::whereIn('cashbox_id', $cashboxes->pluck('id'))
            ->when($from, fn ($q, $v) => $q->where('occurred_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('occurred_at', '<=', $v))
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
            ->when($from, fn ($q, $v) => $q->where('spent_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('spent_at', '<=', $v))
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

        [$from, $to] = $this->localDateBounds($data['from'] ?? null, $data['to'] ?? null);

        // Net of discounts — see revenue() for why adjustments belong here.
        $revenue = PatientTransaction::revenue()
            ->when($from, fn ($q, $v) => $q->where('occurred_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('occurred_at', '<=', $v))
            ->sum('amount_ils');

        $commissions = DoctorTransaction::where('type', 'commission')
            ->when($from, fn ($q, $v) => $q->where('created_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('created_at', '<=', $v))
            ->sum('amount_ils');

        $expenses = Expense::when($from, fn ($q, $v) => $q->where('spent_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('spent_at', '<=', $v))
            ->sum('amount_ils');

        return [
            'revenue_ils' => round((float) $revenue, 2),
            'commissions_ils' => round((float) $commissions, 2),
            'expenses_ils' => round((float) $expenses, 2),
            'net_profit_ils' => round((float) $revenue - (float) $commissions - (float) $expenses, 2),
        ];
    }

    /**
     * The trust check behind every other report: two independent code paths
     * compute "revenue" from two different tables (the patient ledger, and
     * the invoice lines themselves) and nothing used to confirm they agree.
     * If a manual ledger adjustment is ever posted without its matching
     * invoice change (or vice versa), the Revenue tab and the Doctor
     * Productivity / Revenue-by-Service tabs would silently disagree with no
     * way to notice short of hand-auditing the database. This recomputes
     * both paths for the same range and flags any gap beyond rounding, plus
     * a same-range total of everything actually collected (cash, card,
     * transfer, checks) for a quick "does this look right" sanity read.
     */
    public function reconciliation(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        [$from, $to] = $this->localDateBounds($data['from'] ?? null, $data['to'] ?? null);

        // Path A: the patient ledger's own view (charges + adjustments —
        // discounts, reversals, price corrections all included).
        $ledgerRevenue = round((float) PatientTransaction::revenue()
            ->when($from, fn ($q, $v) => $q->where('occurred_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('occurred_at', '<=', $v))
            ->sum('amount_ils'), 2);

        // A whole-account discount (addDiscount()) is deliberately ledger-only
        // — it lowers what the patient owes without touching any one
        // invoice's own total, so it will never show up on the invoice side.
        // Netting it out here before comparing avoids flagging every such
        // discount as a false "mismatch"; it's still reported on its own so
        // it stays visible rather than silently disappearing from the check.
        $accountDiscounts = round((float) PatientTransaction::revenue()
            ->where('reference_type', 'patient_discount')
            ->when($from, fn ($q, $v) => $q->where('occurred_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('occurred_at', '<=', $v))
            ->sum('amount_ils'), 2);

        // Path B: the invoice lines' own view, net of each invoice's discount
        // ratio — same math revenueByService()/doctorProductivity() use, but
        // for every line in range (no doctor/service filter), so it's a true
        // whole-clinic figure to check path A against.
        $lines = InvoiceLine::with('invoice.lines')
            ->when($from, fn ($q, $v) => $q->where('invoice_lines.created_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('invoice_lines.created_at', '<=', $v))
            ->get();
        $net = $this->netLineAmounts($lines);
        $invoiceRevenue = round((float) $lines->sum(fn ($l) => $net[$l->id]), 2);

        $revenueDiff = round(($ledgerRevenue - $accountDiscounts) - $invoiceRevenue, 2);

        // Everything actually collected in range, cash/card/transfer plus
        // patient checks (which never touch the payments table — see
        // collections()) — a side figure, not compared for equality against
        // revenue, since collection timing can lag or lead billing.
        $collectedCashCardTransfer = round((float) Payment::when($from, fn ($q, $v) => $q->where('paid_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('paid_at', '<=', $v))
            ->sum('amount_ils'), 2);

        $collectedChecks = round((float) CheckModel::where('direction', 'incoming')
            ->where('party_type', 'patient')
            ->where('status', '!=', 'bounced')
            ->when($from, fn ($q, $v) => $q->where('received_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('received_at', '<=', $v))
            ->sum('amount'), 2);

        return [
            'range' => ['from' => $data['from'] ?? null, 'to' => $data['to'] ?? null],
            'revenue_check' => [
                'ledger_ils' => $ledgerRevenue,
                'account_discounts_ils' => round(abs($accountDiscounts), 2),
                'invoices_ils' => $invoiceRevenue,
                'difference_ils' => $revenueDiff,
                'ok' => abs($revenueDiff) < 0.5,
            ],
            'collected_ils' => [
                'cash_card_transfer' => $collectedCashCardTransfer,
                'checks' => $collectedChecks,
                'total' => round($collectedCashCardTransfer + $collectedChecks, 2),
            ],
        ];
    }

    /**
     * A real income statement, not the one-line "صافي الربح التقريبي"
     * estimate — every figure that feeds the bottom line is broken out on
     * its own (revenue by service, commissions, every expense category,
     * supplier payments), so "why did profit drop this month" is answered
     * on this one page instead of hunting across five tabs. Accrual-based
     * (revenue = billed net of discount, not just what was collected) —
     * `collected_ils` alongside it shows the cash-in side for comparison,
     * the same split reconciliation() reports.
     */
    public function profitAndLoss(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        [$from, $to] = $this->localDateBounds($data['from'] ?? null, $data['to'] ?? null);

        // Revenue, net of discounts, broken down by service — same
        // netLineAmounts() math every other revenue figure in this
        // controller uses, so this P&L's own revenue line always agrees
        // with the Revenue and Revenue-by-Service tabs.
        $lines = InvoiceLine::with(['workItemToothStep.workItem.service', 'invoice.lines'])
            ->when($from, fn ($q, $v) => $q->where('invoice_lines.created_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('invoice_lines.created_at', '<=', $v))
            ->get();
        $net = $this->netLineAmounts($lines);

        $byService = [];
        foreach ($lines as $line) {
            $name = $line->workItemToothStep?->workItem?->service?->name ?? 'أخرى';
            $byService[$name] = round(($byService[$name] ?? 0) + $net[$line->id], 2);
        }
        arsort($byService);
        $revenue = round(array_sum($byService), 2);

        $commissions = round((float) DoctorTransaction::where('type', 'commission')
            ->when($from, fn ($q, $v) => $q->where('created_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('created_at', '<=', $v))
            ->sum('amount_ils'), 2);

        $expenseRows = Expense::with('category')
            ->when($from, fn ($q, $v) => $q->where('spent_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('spent_at', '<=', $v))
            ->get();
        $byExpenseCategory = [];
        foreach ($expenseRows as $expense) {
            $name = $expense->category?->name ?? 'أخرى';
            $byExpenseCategory[$name] = round(($byExpenseCategory[$name] ?? 0) + (float) $expense->amount_ils, 2);
        }
        arsort($byExpenseCategory);
        $operatingExpenses = round(array_sum($byExpenseCategory), 2);

        // Money actually paid to suppliers in range — 'payment' rows are
        // negative (money out); discounts/credit-notes carry no cash and
        // don't belong in a cash expense line.
        $supplierPayments = round(abs((float) SupplierTransaction::where('type', 'payment')
            ->when($from, fn ($q, $v) => $q->where('occurred_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('occurred_at', '<=', $v))
            ->sum('amount_ils')), 2);

        $totalExpenses = round($commissions + $operatingExpenses + $supplierPayments, 2);

        $collectedCashCardTransfer = round((float) Payment::when($from, fn ($q, $v) => $q->where('paid_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('paid_at', '<=', $v))
            ->sum('amount_ils'), 2);

        $collectedChecks = round((float) CheckModel::where('direction', 'incoming')
            ->where('party_type', 'patient')
            ->where('status', '!=', 'bounced')
            ->when($from, fn ($q, $v) => $q->where('received_at', '>=', $v))
            ->when($to, fn ($q, $v) => $q->where('received_at', '<=', $v))
            ->sum('amount'), 2);

        return [
            'range' => ['from' => $data['from'] ?? null, 'to' => $data['to'] ?? null],
            'income' => [
                'revenue_ils' => $revenue,
                'by_service' => collect($byService)->map(fn ($total, $name) => ['name' => $name, 'total_ils' => $total])->values(),
            ],
            'expenses' => [
                'commissions_ils' => $commissions,
                'operating_ils' => $operatingExpenses,
                'operating_by_category' => collect($byExpenseCategory)->map(fn ($total, $name) => ['name' => $name, 'total_ils' => $total])->values(),
                'supplier_payments_ils' => $supplierPayments,
                'total_ils' => $totalExpenses,
            ],
            'net_profit_ils' => round($revenue - $totalExpenses, 2),
            'collected_ils' => [
                'cash_card_transfer' => $collectedCashCardTransfer,
                'checks' => $collectedChecks,
                'total' => round($collectedCashCardTransfer + $collectedChecks, 2),
            ],
        ];
    }

    /**
     * Full detail for one calendar day: every invoice issued that day and
     * every expense spent that day, plus what was actually collected in
     * cash/card/transfer — issued vs collected can differ (an invoice can
     * be billed today and paid later, or paid off an older invoice today).
     */
    public function dailyDetail(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate(['date' => ['required', 'date']]);

        $timezone = config('dentaflow.display_timezone');
        $day = Carbon::parse($data['date'], $timezone)->startOfDay();
        [$dayStartUtc, $dayEndUtc] = [$day->clone()->timezone('UTC'), $day->clone()->endOfDay()->timezone('UTC')];

        $invoices = Invoice::with('patient')
            ->whereBetween('issued_at', [$dayStartUtc, $dayEndUtc])
            ->orderBy('issued_at')
            ->get();

        $expenses = Expense::with('category')
            ->whereBetween('spent_at', [$dayStartUtc, $dayEndUtc])
            ->orderBy('spent_at')
            ->get();

        $payments = Payment::whereBetween('paid_at', [$dayStartUtc, $dayEndUtc])->get(['amount_ils', 'method']);

        // Checks collected that day count as money taken in, same as cash.
        $checksIn = (float) CheckModel::where('direction', 'incoming')
            ->where('party_type', 'patient')
            ->where('status', '!=', 'bounced')
            ->whereBetween('received_at', [$dayStartUtc, $dayEndUtc])
            ->sum('amount');

        $sessionLabels = SessionLabel::forInvoices($invoices);

        return [
            'date' => $day->format('Y-m-d'),
            'label' => $day->translatedFormat('l d/m/Y'),
            'revenue_ils' => round((float) $invoices->sum('total_amount_ils'), 2),
            'expenses_ils' => round((float) $expenses->sum('amount_ils'), 2),
            'collected_ils' => round((float) $payments->sum('amount_ils') + $checksIn, 2),
            'net_ils' => round((float) $invoices->sum('total_amount_ils') - (float) $expenses->sum('amount_ils'), 2),
            'invoices' => $invoices->map(fn (Invoice $i) => [
                'id' => $i->id,
                'invoice_number' => $i->invoice_number,
                'session_label' => $sessionLabels[$i->id],
                'patient_id' => $i->patient_id,
                'patient_name' => $i->patient?->full_name,
                'status' => $i->status,
                'total_ils' => (float) $i->total_amount_ils,
                'time' => Carbon::parse($i->issued_at)->timezone($timezone)->format('H:i'),
            ])->values(),
            'expenses' => $expenses->map(fn ($e) => [
                'id' => $e->id,
                'category' => $e->category?->name ?? 'أخرى',
                'amount_ils' => (float) $e->amount_ils,
                'description' => $e->description,
                'time' => Carbon::parse($e->spent_at)->timezone($timezone)->format('H:i'),
            ])->values(),
        ];
    }

    /**
     * A calendar week Saturday→Friday (the clinic's own work week, not the
     * ISO/Sunday-start one) — per-day revenue/expenses/net, so the owner can
     * spot which day carried the week and drill into any single day via
     * dailyDetail for the invoice/expense line items.
     */
    public function weeklyDetail(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate(['date' => ['nullable', 'date']]);

        $timezone = config('dentaflow.display_timezone');
        $anchor = isset($data['date']) ? Carbon::parse($data['date'], $timezone) : Carbon::now($timezone);
        $weekStart = $anchor->clone()->startOfWeek(Carbon::SATURDAY)->startOfDay();
        $weekEnd = $weekStart->clone()->addDays(6)->endOfDay();

        $invoices = Invoice::whereBetween('issued_at', [$weekStart->clone()->timezone('UTC'), $weekEnd->clone()->timezone('UTC')])
            ->get(['total_amount_ils', 'issued_at']);
        $expenses = Expense::whereBetween('spent_at', [$weekStart->clone()->timezone('UTC'), $weekEnd->clone()->timezone('UTC')])
            ->get(['amount_ils', 'spent_at']);

        $days = [];
        for ($i = 0; $i < 7; $i++) {
            $d = $weekStart->clone()->addDays($i);
            $dayRevenue = $invoices->filter(fn ($inv) => Carbon::parse($inv->issued_at)->timezone($timezone)->isSameDay($d))->sum('total_amount_ils');
            $dayExpenses = $expenses->filter(fn ($e) => Carbon::parse($e->spent_at)->timezone($timezone)->isSameDay($d))->sum('amount_ils');

            $days[] = [
                'date' => $d->format('Y-m-d'),
                'label' => $d->translatedFormat('D d/m'),
                'revenue_ils' => round((float) $dayRevenue, 2),
                'expenses_ils' => round((float) $dayExpenses, 2),
                'net_ils' => round((float) $dayRevenue - (float) $dayExpenses, 2),
            ];
        }

        return [
            'week_start' => $weekStart->format('Y-m-d'),
            'week_end' => $weekEnd->format('Y-m-d'),
            'days' => $days,
            'totals' => [
                'revenue_ils' => round((float) $invoices->sum('total_amount_ils'), 2),
                'expenses_ils' => round((float) $expenses->sum('amount_ils'), 2),
                'net_ils' => round((float) $invoices->sum('total_amount_ils') - (float) $expenses->sum('amount_ils'), 2),
            ],
        ];
    }
}
