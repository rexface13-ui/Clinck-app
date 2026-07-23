<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Doctor;
use App\Models\DoctorTransaction;
use App\Models\InvoiceLine;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Models\PlanItem;
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

        $query = InvoiceLine::with('planItem.service')
            ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'));

        $totals = [];
        foreach ($query->get() as $line) {
            $name = $line->planItem?->service?->name ?? 'أخرى';
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
            $revenue = InvoiceLine::whereHas('planItem.treatmentPlan', fn ($q) => $q->where('doctor_id', $doctor->id))
                ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
                ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
                ->sum('amount_ils');

            $sessionsCount = InvoiceLine::whereHas('planItem.treatmentPlan', fn ($q) => $q->where('doctor_id', $doctor->id))
                ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
                ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
                ->count();

            $commission = DoctorTransaction::where('doctor_id', $doctor->id)
                ->where('type', 'commission')
                ->when($data['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from))
                ->when($data['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
                ->sum('amount_ils');

            return [
                'doctor_id' => $doctor->id,
                'doctor_name' => $doctor->full_name,
                'sessions_count' => $sessionsCount,
                'revenue_ils' => (float) $revenue,
                'commission_ils' => (float) $commission,
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
     * Patients with unfinished dental work: any item on an approved
     * treatment plan (real plan or an auto-generated quick-visit one alike —
     * this deliberately does NOT exclude appointment_id plans the way
     * "خطط علاجية" does) that still has teeth left in its pool without a
     * 'done' finding. Covers both "never touched" items and items where a
     * past visit finished some teeth but left others "قيد التنفيذ" —
     * regardless of whether that visit's own session/appointment is done.
     */
    public function pendingTreatments(Request $request)
    {
        $this->authorizeView($request);

        $items = PlanItem::whereHas('treatmentPlan', fn ($q) => $q->where('status', 'approved'))
            ->with(['service', 'treatmentPlan.patient', 'treatmentPlan.doctor'])
            ->get();

        $byPatient = [];
        foreach ($items as $item) {
            $remaining = $item->remainingTeeth();
            if (empty($remaining)) {
                continue;
            }

            $patient = $item->treatmentPlan->patient;
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
                'plan_id' => $item->treatment_plan_id,
                'service_name' => $item->service->name ?? 'خدمة',
                'doctor_name' => $item->treatmentPlan->doctor->full_name ?? null,
                'remaining_teeth' => $remaining,
            ];
        }

        return ['patients' => array_values($byPatient)];
    }
}
