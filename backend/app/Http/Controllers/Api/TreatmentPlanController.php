<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\TreatmentPlan\StorePlanItemRequest;
use App\Http\Requests\TreatmentPlan\StoreTreatmentPlanRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\PlanItemResource;
use App\Http\Resources\TreatmentPlanResource;
use App\Models\PlanItem;
use App\Models\TreatmentPlan;
use App\Services\TreatmentPlanService;
use Illuminate\Http\Request;

class TreatmentPlanController extends Controller
{
    public function index(Request $request)
    {
        $this->authorize('viewAny', TreatmentPlan::class);

        $query = TreatmentPlan::with(['doctor', 'items.service'])->orderByDesc('created_at');

        if ($request->filled('patient_id')) {
            $query->where('patient_id', $request->input('patient_id'));
        }

        return TreatmentPlanResource::collection($query->get());
    }

    public function store(StoreTreatmentPlanRequest $request)
    {
        $this->authorize('create', TreatmentPlan::class);

        $plan = TreatmentPlan::create($request->validated() + ['status' => 'draft']);

        return new TreatmentPlanResource($plan->load(['doctor', 'items.service']));
    }

    public function show(TreatmentPlan $treatmentPlan)
    {
        $this->authorize('view', $treatmentPlan);

        return new TreatmentPlanResource($treatmentPlan->load(['doctor', 'items.service', 'items.sessions']));
    }

    public function destroy(TreatmentPlan $treatmentPlan)
    {
        $this->authorize('delete', $treatmentPlan);
        $treatmentPlan->delete();

        return response()->noContent();
    }

    public function addItem(StorePlanItemRequest $request, TreatmentPlan $treatmentPlan)
    {
        $this->authorize('update', $treatmentPlan);
        abort_unless($treatmentPlan->status === 'draft', 422, 'لا يمكن تعديل خطة معتمدة.');

        $item = $treatmentPlan->items()->create($request->validated() + [
            'currency' => $request->input('currency', 'ILS'),
            'sessions_count' => $request->input('sessions_count', 1),
        ]);

        return new PlanItemResource($item->load('service'));
    }

    public function removeItem(TreatmentPlan $treatmentPlan, PlanItem $item)
    {
        $this->authorize('update', $treatmentPlan);
        abort_unless($treatmentPlan->status === 'draft', 422, 'لا يمكن تعديل خطة معتمدة.');
        abort_unless($item->treatment_plan_id === $treatmentPlan->id, 404);

        $item->delete();

        return response()->noContent();
    }

    public function approve(TreatmentPlan $treatmentPlan, TreatmentPlanService $service)
    {
        $this->authorize('update', $treatmentPlan);

        $invoice = $service->approve($treatmentPlan);

        return new InvoiceResource($invoice);
    }

    public function scheduleSessions(TreatmentPlan $treatmentPlan, TreatmentPlanService $service)
    {
        $this->authorize('update', $treatmentPlan);

        $plan = $service->scheduleSessions($treatmentPlan);

        return new TreatmentPlanResource($plan->load(['doctor', 'items.service', 'items.sessions']));
    }
}
