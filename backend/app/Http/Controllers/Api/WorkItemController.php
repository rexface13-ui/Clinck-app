<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\WorkItemResource;
use App\Models\Patient;
use App\Models\Service;
use App\Models\WorkItem;
use App\Models\WorkItemStep;
use App\Models\WorkItemToothStep;
use App\Services\WorkItemService;
use Illuminate\Http\Request;

class WorkItemController extends Controller
{
    protected function authorizeManage(Request $request): void
    {
        abort_unless($request->user()->can('treatment_plans.manage'), 403);
    }

    protected function authorizeView(Request $request): void
    {
        abort_unless($request->user()->can('treatment_plans.view'), 403);
    }

    public function index(Request $request)
    {
        $this->authorizeView($request);

        $data = $request->validate([
            'patient_id' => ['required', 'integer', 'exists:patients,id'],
            'status' => ['sometimes', 'string'],
        ]);

        $query = WorkItem::with(['doctor', 'service', 'teeth', 'steps.toothSteps.invoiceLine', 'steps.serviceStep.fields'])
            ->where('patient_id', $data['patient_id'])
            ->orderByDesc('created_at');

        if (! empty($data['status'])) {
            $query->where('status', $data['status']);
        }

        return WorkItemResource::collection($query->get());
    }

    public function store(Request $request, WorkItemService $service)
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'patient_id' => ['required', 'integer', 'exists:patients,id'],
            'doctor_id' => ['required', 'integer', 'exists:doctors,id'],
            'service_id' => ['required', 'integer', 'exists:services,id'],
            'tooth_numbers' => ['required', 'array', 'min:1'],
            'tooth_numbers.*' => ['integer'],
        ]);

        $patient = Patient::findOrFail($data['patient_id']);
        $svc = Service::with('steps.fields')->findOrFail($data['service_id']);

        $workItem = $service->create($patient, $data['doctor_id'], $svc, $data['tooth_numbers']);

        return new WorkItemResource($workItem);
    }

    public function show(Request $request, WorkItem $workItem)
    {
        $this->authorizeView($request);

        return new WorkItemResource($workItem->load(['doctor', 'service', 'teeth', 'steps.toothSteps.invoiceLine', 'steps.serviceStep.fields']));
    }

    public function updateToothStep(Request $request, WorkItem $workItem, WorkItemToothStep $toothStep, WorkItemService $service)
    {
        $this->authorizeManage($request);
        abort_unless($toothStep->work_item_id === $workItem->id, 404);

        $data = $request->validate([
            'completed' => ['sometimes', 'boolean'],
            'field_values' => ['sometimes', 'array'],
        ]);

        $updated = $service->updateToothStep($toothStep, $data['completed'] ?? null, $data['field_values'] ?? null);

        return response()->json(['id' => $updated->id, 'completed' => $updated->completed_at !== null, 'field_values' => $updated->field_values ?? (object) []]);
    }

    public function addTeeth(Request $request, WorkItem $workItem, WorkItemService $service)
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'tooth_numbers' => ['required', 'array', 'min:1'],
            'tooth_numbers.*' => ['integer'],
        ]);

        $workItem = $service->addTeeth($workItem, $data['tooth_numbers']);

        return new WorkItemResource($workItem);
    }

    public function removeTooth(Request $request, WorkItem $workItem, int $toothNumber, WorkItemService $service)
    {
        $this->authorizeManage($request);

        $service->removeTooth($workItem, $toothNumber);

        return new WorkItemResource($workItem->fresh(['doctor', 'service', 'teeth', 'steps.toothSteps.invoiceLine', 'steps.serviceStep.fields']));
    }

    public function updateStepPrice(Request $request, WorkItem $workItem, WorkItemStep $step, WorkItemService $service)
    {
        $this->authorizeManage($request);
        abort_unless($step->work_item_id === $workItem->id, 404);

        $data = $request->validate(['price' => ['required', 'numeric', 'min:0']]);

        $service->updateStepPrice($step, (float) $data['price']);

        return new WorkItemResource($workItem->fresh(['doctor', 'service', 'teeth', 'steps.toothSteps.invoiceLine', 'steps.serviceStep.fields']));
    }

    public function updateCollectedAmount(Request $request, WorkItem $workItem, WorkItemService $service)
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0'],
            'cashbox_id' => ['nullable', 'integer', 'exists:cashboxes,id'],
            'method' => ['nullable', 'string', 'in:cash,card,transfer,check'],
            'exchange_rate' => ['nullable', 'numeric', 'min:0.000001'],
        ]);

        $updated = $service->updateCollectedAmount(
            $workItem,
            (float) $data['amount'],
            $data['cashbox_id'] ?? null,
            $data['method'] ?? null,
            (float) ($data['exchange_rate'] ?? 1),
        );

        return new WorkItemResource($updated->load(['doctor', 'service', 'teeth', 'steps.toothSteps.invoiceLine', 'steps.serviceStep.fields']));
    }

    public function applyToAll(Request $request, WorkItem $workItem, WorkItemService $service)
    {
        $this->authorizeManage($request);

        $data = $request->validate(['tooth_number' => ['required', 'integer']]);

        $service->applyToAllTeeth($workItem, $data['tooth_number']);

        return new WorkItemResource($workItem->fresh(['doctor', 'service', 'teeth', 'steps.toothSteps.invoiceLine', 'steps.serviceStep.fields']));
    }

    public function checkout(Request $request, WorkItemService $service)
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'patient_id' => ['required', 'integer', 'exists:patients,id'],
            'work_item_ids' => ['required', 'array', 'min:1'],
            'work_item_ids.*' => ['integer'],
            'doctor_id' => ['required', 'integer', 'exists:doctors,id'],
            'discount_amount' => ['sometimes', 'numeric', 'min:0'],
            'pay_cashbox_id' => ['nullable', 'integer', 'exists:cashboxes,id'],
            'pay_method' => ['nullable', 'string', 'in:cash,card,transfer,check'],
            'pay_amount' => ['nullable', 'numeric', 'min:0'],
            'appointment_id' => ['nullable', 'integer', 'exists:appointments,id'],
        ]);

        $patient = Patient::findOrFail($data['patient_id']);

        $result = $service->checkout(
            patient: $patient,
            workItemIds: $data['work_item_ids'],
            doctorId: $data['doctor_id'],
            discountAmount: (float) ($data['discount_amount'] ?? 0),
            payCashboxId: $data['pay_cashbox_id'] ?? null,
            payMethod: $data['pay_method'] ?? null,
            appointmentId: $data['appointment_id'] ?? null,
            payAmount: isset($data['pay_amount']) ? (float) $data['pay_amount'] : null,
        );

        return [
            'invoice_id' => $result['invoice_id'],
            'total_ils' => $result['total_ils'],
            'appointment_id' => $result['appointment_id'],
            'work_items' => WorkItemResource::collection(collect($result['work_items'])),
        ];
    }

    public function schedule(Request $request, WorkItem $workItem, WorkItemService $service)
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after:starts_at'],
        ]);

        $appointment = $service->scheduleRemaining($workItem, $data['starts_at'], $data['ends_at']);

        return response()->json(['appointment_id' => $appointment->id]);
    }

    public function destroy(Request $request, WorkItem $workItem, WorkItemService $service)
    {
        $this->authorizeManage($request);

        $service->cancel($workItem);

        return response()->noContent();
    }
}
