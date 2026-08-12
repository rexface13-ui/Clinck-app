<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Service\StoreServiceCategoryRequest;
use App\Models\Service;
use App\Models\ServiceCategory;
use Illuminate\Http\Request;

class ServiceCategoryController extends Controller
{
    public function index()
    {
        $this->authorize('viewAny', \App\Models\Service::class);

        return ServiceCategory::orderBy('sort_order')->orderBy('name')->get();
    }

    public function store(StoreServiceCategoryRequest $request)
    {
        return ServiceCategory::create($request->validated());
    }

    public function update(Request $request, ServiceCategory $serviceCategory)
    {
        abort_unless($request->user()->can('services.manage'), 403);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
        ]);

        $serviceCategory->update($data);

        return $serviceCategory;
    }

    public function destroy(Request $request, ServiceCategory $serviceCategory)
    {
        abort_unless($request->user()->can('services.manage'), 403);

        // services.service_category_id cascade-deletes at the DB level, and
        // each service's own plan_items/tooth_findings cascade further —
        // deleting a category with services in it would silently wipe them
        // and everything billed against them. Block that; empty the
        // category (reassign or delete its services first) instead.
        abort_if(
            Service::where('service_category_id', $serviceCategory->id)->exists(),
            422,
            'هذا التصنيف يحتوي على خدمات — لا يمكن حذفه نهائياً. احذف أو انقل الخدمات أولاً.',
        );

        $serviceCategory->delete();

        return response()->noContent();
    }
}
