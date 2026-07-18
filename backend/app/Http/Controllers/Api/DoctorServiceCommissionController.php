<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Doctor\StoreServiceCommissionRequest;
use App\Models\Doctor;
use App\Models\DoctorServiceCommission;

class DoctorServiceCommissionController extends Controller
{
    public function store(StoreServiceCommissionRequest $request, Doctor $doctor)
    {
        $this->authorize('update', $doctor);

        $commission = $doctor->serviceCommissions()->updateOrCreate(
            ['service_id' => $request->validated('service_id')],
            ['commission_percent' => $request->validated('commission_percent')],
        );

        return $commission->load('service');
    }

    public function destroy(Doctor $doctor, DoctorServiceCommission $commission)
    {
        $this->authorize('update', $doctor);
        abort_unless($commission->doctor_id === $doctor->id, 404);

        $commission->delete();

        return response()->noContent();
    }
}
