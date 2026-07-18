<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Service\StoreBranchPriceRequest;
use App\Models\BranchServicePrice;
use App\Models\Service;

class BranchServicePriceController extends Controller
{
    public function store(StoreBranchPriceRequest $request, Service $service)
    {
        $this->authorize('update', $service);

        $price = $service->branchPrices()->updateOrCreate(
            ['branch_id' => $request->validated('branch_id')],
            [
                'price' => $request->validated('price'),
                'surcharge' => $request->input('surcharge', 0),
            ],
        );

        return $price;
    }

    public function destroy(Service $service, BranchServicePrice $branchPrice)
    {
        $this->authorize('update', $service);
        abort_unless($branchPrice->service_id === $service->id, 404);

        $branchPrice->delete();

        return response()->noContent();
    }
}
