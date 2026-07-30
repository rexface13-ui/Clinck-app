<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Doctor\StoreDoctorRequest;
use App\Http\Requests\Doctor\UpdateDoctorRequest;
use App\Http\Resources\DoctorResource;
use App\Models\Doctor;
use App\Models\DoctorTransaction;
use App\Models\WorkItem;
use Illuminate\Http\Request;

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

        // appointments.doctor_id is set-null on delete — appointments stay
        // (as "بدون طبيب") instead of being wiped, so they don't block
        // deletion. work_items/doctor_transactions still cascade-delete
        // at the DB level, and those carry real billed/financial history, so
        // those still block: deleting a doctor with billed work or a
        // commission would silently erase it while the patient's charge
        // stays on the ledger with nothing left to trace it back to.
        abort_if(
            WorkItem::where('doctor_id', $doctor->id)->exists()
                || DoctorTransaction::where('doctor_id', $doctor->id)->exists(),
            422,
            'هذا الطبيب عنده شغل مسجّل أو عمولات — لا يمكن حذفه نهائياً حفاظاً على السجل المالي. عطّله من "تعديل" بدلاً من ذلك.',
        );

        $doctor->delete();

        return response()->noContent();
    }

    /**
     * Bypasses the billed-work/commission guard above for cleaning up a
     * test-only doctor — gated behind typing the doctor's exact name.
     * work_items just lose the doctor_id link (nullOnDelete, the patient's
     * clinical/billing record is untouched); availability, commission
     * settings, and any doctor_transactions cascade-delete with them.
     */
    public function forceDestroy(Request $request, Doctor $doctor)
    {
        $this->authorize('delete', $doctor);

        $data = $request->validate(['confirm' => ['required', 'string']]);
        abort_unless($data['confirm'] === $doctor->full_name, 422, 'اكتب اسم الطبيب بالضبط للتأكيد.');

        $doctor->delete();

        return response()->noContent();
    }
}
