<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Patient\StorePatientRequest;
use App\Http\Requests\Patient\UpdatePatientRequest;
use App\Http\Resources\AppointmentResource;
use App\Http\Resources\NoteResource;
use App\Http\Resources\PatientResource;
use App\Http\Resources\ToothFindingResource;
use App\Http\Resources\ToothStateResource;
use App\Models\Patient;
use App\Support\Arabic;
use Illuminate\Http\Request;

class PatientController extends Controller
{
    public function index(Request $request)
    {
        $this->authorize('viewAny', Patient::class);

        if ($request->filled('search')) {
            // Normalize both sides the same way (أ/إ/آ→ا, ة→ه, ى→ي, ...) so
            // a search for "احمد" also finds "أحمد", "فاطمه" finds
            // "فاطمة", etc. — the letter someone happens to type shouldn't
            // matter.
            $search = Arabic::normalize($request->input('search'));
            $nameExpr = Arabic::normalizeSql('full_name');
            $phoneExpr = Arabic::normalizeSql('phone');
            $codeExpr = Arabic::normalizeSql('code');

            return PatientResource::collection(
                Patient::query()
                    ->where(function ($query) use ($search, $nameExpr, $phoneExpr, $codeExpr) {
                        $query->whereRaw("{$nameExpr} ilike ?", ["%{$search}%"])
                            ->orWhereRaw("{$phoneExpr} ilike ?", ["%{$search}%"])
                            ->orWhereRaw("{$codeExpr} ilike ?", ["%{$search}%"]);
                    })
                    ->orderBy('full_name')
                    ->limit(15)
                    ->get()
            );
        }

        return PatientResource::collection(
            Patient::query()->orderByDesc('created_at')->paginate(25)
        );
    }

    public function store(StorePatientRequest $request)
    {
        $this->authorize('create', Patient::class);

        $patient = Patient::create($request->validated());

        return new PatientResource($patient);
    }

    public function show(Patient $patient)
    {
        $this->authorize('view', $patient);

        return new PatientResource($patient);
    }

    public function update(UpdatePatientRequest $request, Patient $patient)
    {
        $this->authorize('update', $patient);

        $patient->update($request->validated());

        return new PatientResource($patient->fresh());
    }

    public function destroy(Patient $patient)
    {
        $this->authorize('delete', $patient);
        $patient->delete();

        return response()->noContent();
    }

    /**
     * Patient profile: info + tooth chart + appointments + notes, in one
     * call — this is the screen the Phase 1 deliverable centers on.
     */
    public function profile(Patient $patient)
    {
        $this->authorize('view', $patient);

        $patient->load([
            'toothStates',
            'toothFindings' => fn ($q) => $q->orderByDesc('recorded_at'),
            'appointments' => fn ($q) => $q->orderByDesc('starts_at')->with('doctor:id,full_name'),
            'notes' => fn ($q) => $q->orderByDesc('created_at')->with('user:id,name'),
        ]);

        return [
            'patient' => new PatientResource($patient),
            'tooth_states' => ToothStateResource::collection($patient->toothStates),
            'tooth_findings' => ToothFindingResource::collection($patient->toothFindings),
            'appointments' => AppointmentResource::collection($patient->appointments),
            'notes' => NoteResource::collection($patient->notes),
        ];
    }
}
