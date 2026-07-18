<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Service\StoreServiceCategoryRequest;
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
        $serviceCategory->delete();

        return response()->noContent();
    }
}
