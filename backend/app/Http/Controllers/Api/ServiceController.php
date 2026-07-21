<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Service\StoreServiceRequest;
use App\Http\Requests\Service\UpdateServiceRequest;
use App\Http\Resources\ServiceResource;
use App\Models\PlanItem;
use App\Models\Service;
use App\Models\ToothFinding;

class ServiceController extends Controller
{
    public function index()
    {
        $this->authorize('viewAny', Service::class);

        return ServiceResource::collection(
            Service::with('branchPrices')->orderBy('name')->get()
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

        return new ServiceResource($service->load('branchPrices'));
    }

    public function update(UpdateServiceRequest $request, Service $service)
    {
        $this->authorize('update', $service);

        $service->update($request->validated());

        return new ServiceResource($service->fresh('branchPrices'));
    }

    public function destroy(Service $service)
    {
        $this->authorize('delete', $service);

        // plan_items.service_id cascade-deletes at the DB level — for a
        // service that was actually billed on an approved plan, that would
        // silently erase the item (and its sessions) while the charge stays
        // on the patient's ledger with nothing left explaining it. Block
        // that instead of letting it happen quietly.
        abort_if(
            PlanItem::where('service_id', $service->id)->exists()
                || ToothFinding::where('service_id', $service->id)->exists(),
            422,
            'هذه الخدمة مستخدمة ضمن خطة علاج أو كشف سن — لا يمكن حذفها نهائياً حفاظاً على السجل المالي. عطّلها من "تعديل" بدلاً من ذلك.',
        );

        $service->delete();

        return response()->noContent();
    }
}
