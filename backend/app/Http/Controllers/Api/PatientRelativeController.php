<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Patient;
use App\Models\PatientRelative;
use Illuminate\Http\Request;

class PatientRelativeController extends Controller
{
    public function index(Request $request, Patient $patient)
    {
        abort_unless($request->user()->can('patients.view'), 403);

        return response()->json($patient->directRelatives()->map(fn ($r) => [
            'relation_id' => $r['relation_id'],
            'label' => $r['label'],
            'patient' => [
                'id' => $r['relative']->id,
                'full_name' => $r['relative']->full_name,
                'code' => $r['relative']->code,
            ],
        ])->values());
    }

    public function store(Request $request, Patient $patient)
    {
        abort_unless($request->user()->can('patients.manage'), 403);

        $data = $request->validate([
            'related_patient_id' => ['required', 'integer', 'exists:patients,id'],
            'label' => ['required', 'string', 'max:255'],
        ]);

        abort_if((int) $data['related_patient_id'] === $patient->id, 422, 'ما فيك تربط المريض بنفسه.');

        $exists = PatientRelative::where(function ($q) use ($patient, $data) {
            $q->where('patient_id', $patient->id)->where('related_patient_id', $data['related_patient_id']);
        })->orWhere(function ($q) use ($patient, $data) {
            $q->where('patient_id', $data['related_patient_id'])->where('related_patient_id', $patient->id);
        })->exists();
        abort_if($exists, 422, 'في ربط أصلاً بين هالمريضين.');

        $relation = PatientRelative::create([
            'patient_id' => $patient->id,
            'related_patient_id' => $data['related_patient_id'],
            'label' => $data['label'],
        ]);

        $related = Patient::findOrFail($data['related_patient_id']);

        return response()->json([
            'relation_id' => $relation->id,
            'label' => $relation->label,
            'patient' => ['id' => $related->id, 'full_name' => $related->full_name, 'code' => $related->code],
        ], 201);
    }

    public function destroy(Request $request, Patient $patient, PatientRelative $relative)
    {
        abort_unless($request->user()->can('patients.manage'), 403);
        abort_unless($relative->patient_id === $patient->id || $relative->related_patient_id === $patient->id, 404);

        $relative->delete();

        return response()->noContent();
    }
}
