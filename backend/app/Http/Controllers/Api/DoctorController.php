<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Doctor\StoreDoctorRequest;
use App\Http\Requests\Doctor\UpdateDoctorRequest;
use App\Http\Resources\DoctorResource;
use App\Models\Doctor;

class DoctorController extends Controller
{
    public function index()
    {
        $this->authorize('viewAny', Doctor::class);

        return DoctorResource::collection(
            Doctor::with(['availability', 'serviceCommissions.service'])->orderBy('full_name')->get()
        );
    }

    public function store(StoreDoctorRequest $request)
    {
        $this->authorize('create', Doctor::class);

        $doctor = Doctor::create($request->validated() + [
            'commission_direction' => $request->input('commission_direction'),
            'is_active' => $request->boolean('is_active', true),
        ]);

        return new DoctorResource($doctor);
    }

    public function show(Doctor $doctor)
    {
        $this->authorize('view', $doctor);

        return new DoctorResource($doctor->load(['availability', 'serviceCommissions.service']));
    }

    public function update(UpdateDoctorRequest $request, Doctor $doctor)
    {
        $this->authorize('update', $doctor);

        $data = $request->validated();
        if ($request->has('contract_type')) {
            $data['commission_direction'] = $request->input('commission_direction');
        }

        $doctor->update($data);

        return new DoctorResource($doctor->fresh(['availability', 'serviceCommissions.service']));
    }

    public function destroy(Doctor $doctor)
    {
        $this->authorize('delete', $doctor);
        $doctor->delete();

        return response()->noContent();
    }
}
