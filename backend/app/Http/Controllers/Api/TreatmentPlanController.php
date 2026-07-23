<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\TreatmentPlan\StorePlanItemRequest;
use App\Http\Requests\TreatmentPlan\StoreTreatmentPlanRequest;
use App\Http\Resources\PlanItemResource;
use App\Http\Resources\TreatmentPlanResource;
use App\Models\PlanItem;
use App\Models\PlanItemSession;
use App\Models\TreatmentPlan;
use App\Services\TreatmentPlanService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TreatmentPlanController extends Controller
{
    public function index(Request $request)
    {
        $this->authorize('viewAny', TreatmentPlan::class);

        // Plans with an appointment_id are the auto-generated single-visit
        // wrapper CompleteVisitModal creates behind the scenes for a
        // same-day "اجاني هلق" visit or a completed booked appointment —
        // an implementation detail of how that billing gets recorded, not
        // a real treatment plan the secretary/doctor made. Those must never
        // show up in the "خطط علاجية" list, which is only for plans someone
        // actually created via "خطة جديدة".
        $query = TreatmentPlan::with(['doctor', 'items.service'])
            ->whereNull('appointment_id')
            ->orderByDesc('created_at');

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

    public function update(Request $request, TreatmentPlan $treatmentPlan)
    {
        $this->authorize('update', $treatmentPlan);
        abort_if($treatmentPlan->status === 'cancelled', 422, 'ما بينفع تعديل خطة ملغاة.');

        $data = $request->validate([
            'notes' => ['sometimes', 'nullable', 'string'],
            'doctor_id' => ['sometimes', 'nullable', 'exists:doctors,id'],
        ]);

        $treatmentPlan->update($data);

        return new TreatmentPlanResource($treatmentPlan->fresh()->load(['doctor', 'items.service']));
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
        // Allowed for draft AND approved plans — a doctor can decide mid-treatment
        // that another service is needed without having to start a new plan.
        abort_if($treatmentPlan->status === 'cancelled', 422, 'ما بينفع تعديل خطة ملغاة.');

        $data = $request->validated();

        // tooth_number stays populated even for a multi-tooth item (as its
        // first tooth) so any code that only reads the singular column —
        // "is this tooth busy on a plan" checks, older data, etc. — still
        // works without having to know about tooth_numbers.
        if (! empty($data['tooth_numbers']) && empty($data['tooth_number'])) {
            $data['tooth_number'] = $data['tooth_numbers'][0];
        }

        $item = $treatmentPlan->items()->create($data + [
            'currency' => $request->input('currency', 'ILS'),
            'sessions_count' => $request->input('sessions_count', 1),
        ]);

        return new PlanItemResource($item->load('service'));
    }

    public function updateItemTeeth(Request $request, TreatmentPlan $treatmentPlan, PlanItem $item)
    {
        $this->authorize('update', $treatmentPlan);
        abort_unless($item->treatment_plan_id === $treatmentPlan->id, 404);

        $data = $request->validate([
            'tooth_numbers' => ['required', 'array', 'min:1'],
            'tooth_numbers.*' => ['integer', Rule::in(\App\Support\Dental\FdiTeeth::validNumbers())],
        ]);

        $item->update([
            'tooth_numbers' => $data['tooth_numbers'],
            'tooth_number' => $data['tooth_numbers'][0],
        ]);

        return new PlanItemResource($item->fresh()->load('service'));
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

        $plan = $service->approve($treatmentPlan);

        return new TreatmentPlanResource($plan->load(['doctor', 'items.service', 'items.sessions']));
    }

    public function scheduleSessions(TreatmentPlan $treatmentPlan, TreatmentPlanService $service)
    {
        $this->authorize('update', $treatmentPlan);

        $plan = $service->scheduleSessions($treatmentPlan);

        return new TreatmentPlanResource($plan->load(['doctor', 'items.service', 'items.sessions']));
    }

    public function cancel(TreatmentPlan $treatmentPlan, TreatmentPlanService $service)
    {
        $this->authorize('cancel', $treatmentPlan);

        $plan = $service->cancel($treatmentPlan);

        return new TreatmentPlanResource($plan->load(['doctor', 'items.service', 'items.sessions']));
    }

    public function cancelItem(TreatmentPlan $treatmentPlan, PlanItem $item, TreatmentPlanService $service)
    {
        $this->authorize('cancel', $treatmentPlan);
        abort_unless($item->treatment_plan_id === $treatmentPlan->id, 404);

        $plan = $service->cancelItem($item);

        return new TreatmentPlanResource($plan->load(['doctor', 'items.service', 'items.sessions']));
    }

    public function completeSession(Request $request, TreatmentPlan $treatmentPlan, PlanItem $item, PlanItemSession $session, TreatmentPlanService $service)
    {
        $this->authorize('update', $treatmentPlan);
        abort_unless($item->treatment_plan_id === $treatmentPlan->id, 404);
        abort_unless($session->plan_item_id === $item->id, 404);

        $data = $request->validate([
            'price' => ['required', 'numeric', 'min:0'],
            'pay_now' => ['sometimes', 'boolean'],
            'cashbox_id' => ['required_if:pay_now,true', 'integer', 'exists:cashboxes,id'],
            'method' => ['sometimes', 'string', 'in:cash,card,transfer,check'],
        ]);

        $service->completeSession(
            $session,
            (float) $data['price'],
            $request->boolean('pay_now') ? (int) $data['cashbox_id'] : null,
            $data['method'] ?? null,
        );

        return new TreatmentPlanResource($treatmentPlan->fresh(['doctor', 'items.service', 'items.sessions']));
    }

    public function cancelSession(TreatmentPlan $treatmentPlan, PlanItem $item, PlanItemSession $session, TreatmentPlanService $service)
    {
        $this->authorize('cancel', $treatmentPlan);
        abort_unless($item->treatment_plan_id === $treatmentPlan->id, 404);
        abort_unless($session->plan_item_id === $item->id, 404);

        $service->cancelSession($session);

        return new TreatmentPlanResource($treatmentPlan->fresh(['doctor', 'items.service', 'items.sessions']));
    }

    public function recordSession(Request $request, TreatmentPlan $treatmentPlan, TreatmentPlanService $service)
    {
        $this->authorize('update', $treatmentPlan);

        $data = $request->validate([
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.item_id' => ['required', 'integer'],
            'lines.*.tooth_numbers' => ['nullable', 'array', 'min:1'],
            'lines.*.tooth_numbers.*' => ['integer'],
            'lines.*.pending_teeth' => ['nullable', 'array'],
            'lines.*.pending_teeth.*' => ['integer'],
            'lines.*.price' => ['required', 'numeric', 'min:0'],
            'pay_now' => ['sometimes', 'boolean'],
            'cashbox_id' => ['required_if:pay_now,true', 'integer', 'exists:cashboxes,id'],
            'method' => ['sometimes', 'string', 'in:cash,card,transfer,check'],
        ]);

        $appointment = $service->recordSessionVisit(
            $treatmentPlan,
            $data['lines'],
            $request->boolean('pay_now') ? (int) $data['cashbox_id'] : null,
            $data['method'] ?? null,
        );

        return response()->json([
            'appointment_id' => $appointment->id,
            'plan' => (new TreatmentPlanResource($treatmentPlan->fresh(['doctor', 'items.service', 'items.sessions'])))->toArray($request),
        ]);
    }

    public function updateSession(Request $request, TreatmentPlan $treatmentPlan, PlanItem $item, PlanItemSession $session, TreatmentPlanService $service)
    {
        $this->authorize('update', $treatmentPlan);
        abort_unless($item->treatment_plan_id === $treatmentPlan->id, 404);
        abort_unless($session->plan_item_id === $item->id, 404);

        $data = $request->validate([
            'price' => ['sometimes', 'numeric', 'min:0'],
            'note' => ['sometimes', 'nullable', 'string'],
        ]);

        $service->updateSession(
            $session,
            array_key_exists('price', $data) ? (float) $data['price'] : null,
            array_key_exists('note', $data) ? $data['note'] : null,
        );

        return new TreatmentPlanResource($treatmentPlan->fresh(['doctor', 'items.service', 'items.sessions']));
    }
}
