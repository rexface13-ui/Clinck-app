<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Appointment\StoreAppointmentRequest;
use App\Http\Requests\Appointment\UpdateAppointmentRequest;
use App\Http\Resources\AppointmentResource;
use App\Models\Appointment;
use Illuminate\Http\Request;

class AppointmentController extends Controller
{
    public function index(Request $request)
    {
        $this->authorize('viewAny', Appointment::class);

        $query = Appointment::with(['patient:id,full_name', 'doctor:id,full_name'])
            ->orderBy('starts_at');

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

        return AppointmentResource::collection($query->get());
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

        return new AppointmentResource($appointment->load(['patient', 'doctor']));
    }

    public function update(UpdateAppointmentRequest $request, Appointment $appointment)
    {
        $this->authorize('update', $appointment);

        $appointment->update($request->validated());

        return new AppointmentResource($appointment->fresh(['patient', 'doctor']));
    }

    public function destroy(Appointment $appointment)
    {
        $this->authorize('delete', $appointment);
        $appointment->delete();

        return response()->noContent();
    }
}
