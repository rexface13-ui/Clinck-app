<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Doctor\StoreAvailabilityRequest;
use App\Http\Resources\DoctorAvailabilityResource;
use App\Models\Doctor;
use App\Models\DoctorAvailability;

class DoctorAvailabilityController extends Controller
{
    public function store(StoreAvailabilityRequest $request, Doctor $doctor)
    {
        $this->authorize('update', $doctor);

        $availability = $doctor->availability()->create($request->validated());

        return new DoctorAvailabilityResource($availability);
    }

    public function destroy(Doctor $doctor, DoctorAvailability $availability)
    {
        $this->authorize('update', $doctor);
        abort_unless($availability->doctor_id === $doctor->id, 404);

        $availability->delete();

        return response()->noContent();
    }
}
