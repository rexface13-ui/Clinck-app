<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Service\StoreServiceRequest;
use App\Http\Requests\Service\UpdateServiceRequest;
use App\Http\Resources\ServiceResource;
use App\Models\Service;
use App\Models\ServiceStep;
use App\Models\ServiceStepField;
use App\Models\ToothFinding;
use App\Models\WorkItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ServiceController extends Controller
{
    public function index()
    {
        $this->authorize('viewAny', Service::class);

        return ServiceResource::collection(
            Service::with(['branchPrices', 'steps.fields'])->orderBy('name')->get()
        );
    }

    public function store(StoreServiceRequest $request)
    {
        $this->authorize('create', Service::class);

        $service = Service::create($request->validated() + [
            'default_currency' => $request->input('default_currency', 'ILS'),
            'default_sessions' => $request->input('default_sessions', 1),
            'is_active' => $request->boolean('is_active', true),
        ]);

        return new ServiceResource($service);
    }

    public function show(Service $service)
    {
        $this->authorize('view', $service);

        return new ServiceResource($service->load(['branchPrices', 'steps.fields']));
    }

    public function update(UpdateServiceRequest $request, Service $service)
    {
        $this->authorize('update', $service);

        $data = $request->validated();

        // A work item snapshots price_per_tooth from its service at creation
        // time (so a later price-model change doesn't retroactively rewrite
        // an already-agreed session) — but early on, while the clinic is
        // still tuning how each service should bill, that snapshot is more
        // often a mistake to fix everywhere than a deliberate difference to
        // preserve. So a change here is pushed onto every existing work item
        // for this service too, not just future ones.
        $pricingChanged = array_key_exists('price_per_tooth', $data) && (bool) $data['price_per_tooth'] !== (bool) $service->price_per_tooth;

        $service->update($data);

        if ($pricingChanged) {
            WorkItem::where('service_id', $service->id)->update(['price_per_tooth' => $data['price_per_tooth']]);
        }

        return new ServiceResource($service->fresh(['branchPrices', 'steps.fields']));
    }

    public function destroy(Service $service)
    {
        $this->authorize('delete', $service);

        // work_items.service_id cascade-deletes at the DB level — for a
        // service that was actually billed on a real work item, that would
        // silently erase the item (and its steps) while the charge stays
        // on the patient's ledger with nothing left explaining it. Block
        // that instead of letting it happen quietly.
        abort_if(
            WorkItem::where('service_id', $service->id)->exists()
                || ToothFinding::where('service_id', $service->id)->exists(),
            422,
            'هذه الخدمة مستخدمة ضمن شغل مسجّل أو كشف سن — لا يمكن حذفها نهائياً حفاظاً على السجل المالي. عطّلها من "تعديل" بدلاً من ذلك.',
        );

        $service->delete();

        return response()->noContent();
    }

    /**
     * Replaces this service's entire step list in one call — simplest
     * correct way to keep step ordering/fields in sync without a diffing
     * API. Safe because work items snapshot a service's steps at creation
     * time, so editing them here never touches history already in progress.
     */
    public function updateSteps(Request $request, Service $service)
    {
        $this->authorize('update', $service);

        $data = $request->validate([
            'steps' => ['present', 'array'],
            'steps.*.title' => ['required', 'string', 'max:255'],
            'steps.*.price' => ['required', 'numeric', 'min:0'],
            'steps.*.fields' => ['sometimes', 'array'],
            'steps.*.fields.*.label' => ['required', 'string', 'max:255'],
        ]);

        $stepsTotal = collect($data['steps'])->sum('price');
        abort_if(
            $stepsTotal > (float) $service->default_price,
            422,
            'مجموع أسعار الخطوات (' . $stepsTotal . ') أكبر من سعر الخدمة (' . $service->default_price . ').',
        );

        DB::transaction(function () use ($data, $service) {
            $service->steps()->each(function (ServiceStep $step) {
                $step->fields()->delete();
                $step->delete();
            });

            foreach ($data['steps'] as $i => $stepData) {
                $step = ServiceStep::create([
                    'service_id' => $service->id,
                    'title' => $stepData['title'],
                    'price' => $stepData['price'],
                    'sort_order' => $i,
                ]);

                foreach ($stepData['fields'] ?? [] as $j => $fieldData) {
                    ServiceStepField::create([
                        'service_step_id' => $step->id,
                        'label' => $fieldData['label'],
                        'sort_order' => $j,
                    ]);
                }
            }
        });

        return new ServiceResource($service->fresh(['branchPrices', 'steps.fields']));
    }
}
