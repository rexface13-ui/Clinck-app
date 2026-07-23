<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\PrescriptionResource;
use App\Models\Prescription;
use Illuminate\Http\Request;

class PrescriptionController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('patients.view'), 403);

        $data = $request->validate([
            'patient_id' => ['required', 'integer', 'exists:patients,id'],
        ]);

        $prescriptions = Prescription::with('doctor')
            ->where('patient_id', $data['patient_id'])
            ->orderByDesc('created_at')
            ->get();

        return PrescriptionResource::collection($prescriptions);
    }

    public function store(Request $request)
    {
        abort_unless($request->user()->can('treatment_plans.manage'), 403);

        $data = $request->validate([
            'patient_id' => ['required', 'integer', 'exists:patients,id'],
            'doctor_id' => ['nullable', 'integer', 'exists:doctors,id'],
            'plan_item_session_id' => ['nullable', 'integer', 'exists:plan_item_sessions,id'],
            'medications' => ['required', 'string'],
            'notes' => ['nullable', 'string'],
        ]);

        $prescription = Prescription::create($data);

        return new PrescriptionResource($prescription->load('doctor'));
    }
}
