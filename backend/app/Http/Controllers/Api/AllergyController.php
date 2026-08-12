<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Allergy;
use App\Models\Patient;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AllergyController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('medications.view'), 403);

        return Allergy::orderBy('name')->get();
    }

    /** Also used inline from the patient form (MedicalHistoryField) to add a custom allergy on the fly — updateOrCreate so typing an existing name twice is a silent no-op instead of a unique-constraint error. */
    public function store(Request $request)
    {
        abort_unless($request->user()->can('medications.manage') || $request->user()->can('patients.manage'), 403);

        $data = $request->validate(['name' => ['required', 'string', 'max:255']]);

        return Allergy::firstOrCreate(['name' => $data['name']]);
    }

    public function update(Request $request, Allergy $allergy)
    {
        abort_unless($request->user()->can('medications.manage'), 403);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255', Rule::unique('allergies', 'name')->ignore($allergy->id)],
        ]);

        $allergy->update($data);

        return $allergy;
    }

    public function destroy(Request $request, Allergy $allergy)
    {
        abort_unless($request->user()->can('medications.manage'), 403);

        // Patients reference allergies by name (medical_alerts is a plain
        // string array, not a foreign key) — deleting the catalog entry
        // can't leave anything dangling there. Only guard against
        // medications still linked to it.
        abort_if(
            $allergy->medications()->exists(),
            422,
            'هاي الحساسية مربوطة بدواء أو أكتر — احذف الربط منهم أولاً.',
        );

        abort_if(
            Patient::whereJsonContains('medical_alerts', $allergy->name)->exists(),
            422,
            'هاي الحساسية مستخدمة بملف مريض — لا يمكن حذفها.',
        );

        $allergy->delete();

        return response()->noContent();
    }
}
