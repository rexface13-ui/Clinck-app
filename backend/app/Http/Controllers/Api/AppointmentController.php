<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Appointment\StoreAppointmentRequest;
use App\Http\Requests\Appointment\UpdateAppointmentRequest;
use App\Http\Resources\AppointmentResource;
use App\Models\ActivityLog;
use App\Models\Appointment;
use App\Models\PlanItemSession;
use App\Models\TreatmentPlan;
use App\Services\TreatmentPlanService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AppointmentController extends Controller
{
    public function index(Request $request)
    {
        $this->authorize('viewAny', Appointment::class);

        $query = Appointment::with(['patient:id,full_name', 'doctor:id,full_name']);

        if ($request->filled('doctor_id')) {
            $query->where('doctor_id', $request->input('doctor_id'));
        }

        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->input('branch_id'));
        }

        if ($request->filled('from')) {
            $query->where('starts_at', '>=', $request->input('from'));
        }

        if ($request->filled('to')) {
            $query->where('starts_at', '<=', $request->input('to'));
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->filled('search')) {
            $search = $request->input('search');
            $query->whereHas('patient', fn ($p) => $p->where('full_name', 'like', "%{$search}%"));
        }

        return AppointmentResource::collection($query->orderByDesc('starts_at')->get());
    }

    public function store(StoreAppointmentRequest $request)
    {
        $this->authorize('create', Appointment::class);

        $appointment = Appointment::create($request->validated() + [
            'status' => 'scheduled',
            'created_via' => 'web',
        ]);

        return new AppointmentResource($appointment->load(['patient', 'doctor']));
    }

    public function show(Appointment $appointment)
    {
        $this->authorize('view', $appointment);

        return new AppointmentResource($appointment->load(['patient', 'doctor', 'treatmentPlan.items.service', 'treatmentPlan.doctor']));
    }

    public function update(UpdateAppointmentRequest $request, Appointment $appointment)
    {
        $this->authorize('update', $appointment);

        $appointment->update($request->validated());

        return new AppointmentResource($appointment->fresh(['patient', 'doctor']));
    }

    public function destroy(Appointment $appointment, TreatmentPlanService $planService)
    {
        $this->authorize('delete', $appointment);

        $appointment->loadMissing(['patient:id,full_name', 'doctor:id,full_name']);
        ActivityLog::record('appointment.deleted', sprintf(
            'حذف موعد %s مع %s بتاريخ %s',
            $appointment->patient?->full_name ?? 'مريض محذوف',
            $appointment->doctor?->full_name ?? 'بدون طبيب',
            $appointment->starts_at->format('d/m/Y H:i'),
        ));

        DB::transaction(function () use ($appointment, $planService) {
            // Deleting an appointment that a treatment-plan session had booked
            // must undo everything tied to that session: cancelSession()
            // reverses its own charge (if it had already been billed as
            // "done"), rolls back its tooth finding/commission, and clears
            // the booking — without touching the item's other sessions.
            $sessions = PlanItemSession::where('appointment_id', $appointment->id)->get();
            foreach ($sessions as $session) {
                $planService->cancelSession($session);
            }

            // A "زيارة الآن" visit creates the appointment and its treatment
            // plan together as one unit (see CompleteVisitModal). Deleting
            // that appointment must undo the plan too, or the invoice/charge
            // it generated is silently orphaned — the account would keep
            // showing a debt with no visible way to trace or reverse it.
            $plan = TreatmentPlan::where('appointment_id', $appointment->id)->first();
            if ($plan) {
                if ($plan->status === 'approved') {
                    $planService->cancel($plan);
                } elseif ($plan->status === 'draft') {
                    $plan->delete();
                }
            }

            $appointment->delete();
        });

        return response()->noContent();
    }
}
