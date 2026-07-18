<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Service\StoreServiceRequest;
use App\Http\Requests\Service\UpdateServiceRequest;
use App\Http\Resources\ServiceResource;
use App\Models\Service;

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
        $service->delete();

        return response()->noContent();
    }
}
