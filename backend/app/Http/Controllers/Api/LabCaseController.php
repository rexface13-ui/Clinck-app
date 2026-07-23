<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\LabCaseResource;
use App\Models\LabCase;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class LabCaseController extends Controller
{
    protected function authorizeManage(Request $request): void
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);
    }

    public function index(Request $request)
    {
        abort_unless($request->user()->can('purchasing.view'), 403);

        $query = LabCase::with(['patient', 'doctor', 'supplier'])->orderByDesc('sent_at');

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }
        if ($request->filled('patient_id')) {
            $query->where('patient_id', $request->input('patient_id'));
        }

        return LabCaseResource::collection($query->get());
    }

    public function store(Request $request)
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'patient_id' => ['required', 'integer', 'exists:patients,id'],
            'doctor_id' => ['nullable', 'integer', 'exists:doctors,id'],
            'supplier_id' => ['required', 'integer', 'exists:suppliers,id'],
            'description' => ['required', 'string', 'max:255'],
            'tooth_numbers' => ['nullable', 'array'],
            'tooth_numbers.*' => ['integer'],
            'sent_at' => ['required', 'date'],
            'expected_return_date' => ['required', 'date'],
            'notes' => ['nullable', 'string'],
        ]);

        $labCase = LabCase::create($data + ['status' => 'sent']);

        return new LabCaseResource($labCase->load(['patient', 'doctor', 'supplier']));
    }

    public function update(Request $request, LabCase $labCase)
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'description' => ['sometimes', 'string', 'max:255'],
            'expected_return_date' => ['sometimes', 'date'],
            'notes' => ['sometimes', 'nullable', 'string'],
            'status' => ['sometimes', Rule::in(['sent', 'ready', 'received'])],
        ]);

        if (($data['status'] ?? null) === 'received' && $labCase->status !== 'received') {
            $data['received_at'] = now();
        }

        $labCase->update($data);

        return new LabCaseResource($labCase->fresh(['patient', 'doctor', 'supplier']));
    }

    public function destroy(Request $request, LabCase $labCase)
    {
        $this->authorizeManage($request);

        $labCase->delete();

        return response()->noContent();
    }
}
