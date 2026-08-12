<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Medication;
use App\Models\Prescription;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MedicationController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('medications.view'), 403);

        return Medication::with('allergies')->orderBy('name')->get();
    }

    public function store(Request $request)
    {
        abort_unless($request->user()->can('medications.manage'), 403);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'form' => ['nullable', 'string', 'max:100'],
            'usage_instructions' => ['nullable', 'string'],
            'allergy_ids' => ['sometimes', 'array'],
            'allergy_ids.*' => ['integer', 'exists:allergies,id'],
        ]);

        $medication = DB::transaction(function () use ($data) {
            $medication = Medication::create([
                'name' => $data['name'],
                'form' => $data['form'] ?? null,
                'usage_instructions' => $data['usage_instructions'] ?? null,
            ]);
            $medication->allergies()->sync($data['allergy_ids'] ?? []);

            return $medication;
        });

        return $medication->load('allergies');
    }

    public function update(Request $request, Medication $medication)
    {
        abort_unless($request->user()->can('medications.manage'), 403);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'form' => ['sometimes', 'nullable', 'string', 'max:100'],
            'usage_instructions' => ['sometimes', 'nullable', 'string'],
            'is_active' => ['sometimes', 'boolean'],
            'allergy_ids' => ['sometimes', 'array'],
            'allergy_ids.*' => ['integer', 'exists:allergies,id'],
        ]);

        DB::transaction(function () use ($medication, $data) {
            $medication->update(collect($data)->except('allergy_ids')->all());

            if (array_key_exists('allergy_ids', $data)) {
                $medication->allergies()->sync($data['allergy_ids']);
            }
        });

        return $medication->fresh('allergies');
    }

    public function destroy(Request $request, Medication $medication)
    {
        abort_unless($request->user()->can('medications.manage'), 403);

        abort_if(
            Prescription::where('medications', 'like', '%'.$medication->name.'%')->exists(),
            422,
            'هاد الدواء مكتوب بروشتة سابقة — عطّله من "تعديل" بدلاً من حذفه نهائياً.',
        );

        $medication->delete();

        return response()->noContent();
    }
}
