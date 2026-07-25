<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Patient\StorePatientRequest;
use App\Http\Requests\Patient\UpdatePatientRequest;
use App\Http\Resources\AppointmentResource;
use App\Http\Resources\AttachmentResource;
use App\Http\Resources\NoteResource;
use App\Http\Resources\PatientResource;
use App\Http\Resources\ToothFindingResource;
use App\Http\Resources\ToothStateResource;
use App\Models\Appointment;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\ToothFinding;
use App\Models\WorkItem;
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

        // appointments/work_items/invoices/payments/patient_transactions
        // all cascade-delete on patient_id at the DB level — for a patient
        // with any real visit or billing history that would silently wipe
        // the clinical/financial record. Block that; a patient can only be
        // removed while they're still an empty shell (added by mistake,
        // never seen).
        abort_if(
            $patient->appointments()->exists()
                || WorkItem::where('patient_id', $patient->id)->exists()
                || PatientTransaction::where('patient_id', $patient->id)->exists()
                || ToothFinding::where('patient_id', $patient->id)->exists(),
            422,
            'هذا المريض له سجل زيارات أو شغل مسجّل أو حركات مالية — لا يمكن حذفه نهائياً حفاظاً على السجل.',
        );

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
            'attachments' => fn ($q) => $q->orderByDesc('id')->with('uploader:id,name'),
        ]);

        return [
            'patient' => new PatientResource($patient),
            'tooth_states' => ToothStateResource::collection($patient->toothStates),
            'tooth_findings' => ToothFindingResource::collection($patient->toothFindings),
            'appointments' => AppointmentResource::collection($patient->appointments),
            'notes' => NoteResource::collection($patient->notes),
            'attachments' => AttachmentResource::collection($patient->attachments),
        ];
    }
}
