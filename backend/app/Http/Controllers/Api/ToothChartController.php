<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Dental\StoreToothFindingRequest;
use App\Http\Resources\ToothFindingResource;
use App\Http\Resources\ToothStateResource;
use App\Models\Patient;
use App\Models\ToothFinding;
use App\Services\CommissionService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

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
            ->where('finding_type', 'extraction')
            ->where('status', 'done')
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

            $isExtractionDone = $data['finding_type'] === 'extraction' && $data['status'] === 'done';

            $patient->toothStates()->updateOrCreate(
                ['tooth_number' => $data['tooth_number']],
                ['status' => $isExtractionDone ? 'missing' : 'present'],
            );

            if ($data['status'] === 'done') {
                $commissions->computeForFinding($finding);
            }

            return $finding;
        });

        return new ToothFindingResource($finding->load(['service', 'doctor']));
    }

    public function destroyFinding(Request $request, Patient $patient, ToothFinding $finding)
    {
        $this->authorize('update', $patient);
        abort_unless($request->user()->can('dental_chart.manage'), 403);
        abort_unless($finding->patient_id === $patient->id, 404);

        DB::transaction(function () use ($finding, $patient) {
            $toothNumber = $finding->tooth_number;
            $finding->delete();

            $stillExtracted = $patient->toothFindings()
                ->where('tooth_number', $toothNumber)
                ->where('finding_type', 'extraction')
                ->where('status', 'done')
                ->exists();

            $patient->toothStates()->updateOrCreate(
                ['tooth_number' => $toothNumber],
                ['status' => $stillExtracted ? 'missing' : 'present'],
            );
        });

        return response()->noContent();
    }
}
