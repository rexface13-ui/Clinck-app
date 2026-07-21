<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Dental\StoreToothFindingRequest;
use App\Http\Resources\ToothFindingResource;
use App\Http\Resources\ToothStateResource;
use App\Models\Patient;
use App\Models\PlanItem;
use App\Models\ToothFinding;
use App\Services\CommissionService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ToothChartController extends Controller
{
    /**
     * The chart is always derived from tooth_findings, never stored as an
     * image. Without ?as_of it reflects tooth_states (the fast current
     * snapshot); with ?as_of it's recomputed from findings recorded on or
     * before that date, ignoring tooth_states entirely.
     */
    public function show(Request $request, Patient $patient)
    {
        $this->authorize('view', $patient);

        $asOf = $request->query('as_of');

        if (! $asOf) {
            $states = $patient->toothStates()->get();
            $findings = $patient->toothFindings()->orderByDesc('recorded_at')->with(['service', 'doctor'])->get();

            return [
                'tooth_states' => ToothStateResource::collection($states),
                'tooth_findings' => ToothFindingResource::collection($findings),
            ];
        }

        $cutoff = Carbon::parse($asOf)->endOfDay();

        $findings = $patient->toothFindings()
            ->where('recorded_at', '<=', $cutoff)
            ->orderByDesc('recorded_at')
            ->with(['service', 'doctor'])
            ->get();

        $missingTeeth = $findings
            ->where('marks_missing', true)
            ->pluck('tooth_number')
            ->unique();

        $states = $missingTeeth->map(fn ($toothNumber) => (object) [
            'tooth_number' => $toothNumber,
            'status' => 'missing',
        ])->values();

        return [
            'tooth_states' => ToothStateResource::collection($states),
            'tooth_findings' => ToothFindingResource::collection($findings),
        ];
    }

    public function storeFinding(StoreToothFindingRequest $request, Patient $patient, CommissionService $commissions)
    {
        $this->authorize('update', $patient);
        abort_unless($request->user()->can('dental_chart.manage'), 403);

        $data = $request->validated();
        $data['recorded_at'] ??= now();

        $finding = DB::transaction(function () use ($data, $patient, $commissions) {
            $finding = $patient->toothFindings()->create($data);

            // marks_missing is an explicit flag from the client (a checkbox, not
            // a guess based on what the free-text finding_type says) — a tooth
            // can go missing for any reason (extraction, trauma, congenitally
            // absent...), so nothing here hinges on specific wording. Only ever
            // flips a tooth TO missing here — reverting it to present happens
            // when the finding that marked it missing is deleted (see
            // destroyFinding), not as a side effect of unrelated findings.
            if ($data['marks_missing'] ?? false) {
                $patient->toothStates()->updateOrCreate(
                    ['tooth_number' => $data['tooth_number']],
                    ['status' => 'missing'],
                );
            }

            if ($data['status'] === 'done') {
                $commissions->computeForFinding($finding);
            }

            return $finding;
        });

        return new ToothFindingResource($finding->load(['service', 'doctor']));
    }

    public function updateFinding(Request $request, Patient $patient, ToothFinding $finding, CommissionService $commissions)
    {
        $this->authorize('update', $patient);
        abort_unless($request->user()->can('dental_chart.manage'), 403);
        abort_unless($finding->patient_id === $patient->id, 404);

        $data = $request->validate([
            'status' => ['sometimes', 'in:planned,in_progress,done'],
            'note' => ['sometimes', 'nullable', 'string'],
            'doctor_id' => ['sometimes', 'nullable', 'exists:doctors,id'],
            'marks_missing' => ['sometimes', 'boolean'],
            'performed_externally' => ['sometimes', 'boolean'],
            'plan_item_session_id' => [
                'sometimes', 'nullable',
                Rule::exists('plan_item_sessions', 'id')->where(
                    fn ($q) => $q->whereIn('plan_item_id', PlanItem::whereHas(
                        'treatmentPlan', fn ($q2) => $q2->where('patient_id', $patient->id)
                    )->pluck('id'))
                ),
            ],
        ]);

        DB::transaction(function () use ($data, $finding, $patient, $commissions) {
            $wasMissing = $finding->marks_missing;
            $finding->update($data);

            if (array_key_exists('marks_missing', $data) && $data['marks_missing'] !== $wasMissing) {
                $stillMissing = $patient->toothFindings()
                    ->where('tooth_number', $finding->tooth_number)
                    ->where('marks_missing', true)
                    ->exists();

                $patient->toothStates()->updateOrCreate(
                    ['tooth_number' => $finding->tooth_number],
                    ['status' => $stillMissing ? 'missing' : 'present'],
                );
            }

            if (($data['status'] ?? null) === 'done') {
                $commissions->computeForFinding($finding->fresh());
            }
        });

        return new ToothFindingResource($finding->fresh(['service', 'doctor']));
    }

    public function destroyFinding(Request $request, Patient $patient, ToothFinding $finding)
    {
        $this->authorize('update', $patient);
        abort_unless($request->user()->can('dental_chart.manage'), 403);
        abort_unless($finding->patient_id === $patient->id, 404);

        DB::transaction(function () use ($finding, $patient) {
            $toothNumber = $finding->tooth_number;
            $finding->delete();

            $stillMissing = $patient->toothFindings()
                ->where('tooth_number', $toothNumber)
                ->where('marks_missing', true)
                ->exists();

            $patient->toothStates()->updateOrCreate(
                ['tooth_number' => $toothNumber],
                ['status' => $stillMissing ? 'missing' : 'present'],
            );
        });

        return response()->noContent();
    }
}
