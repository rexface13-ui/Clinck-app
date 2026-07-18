<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ItemCategory;
use Illuminate\Http\Request;

class ItemCategoryController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('inventory.view'), 403);

        return ItemCategory::orderBy('name')->get();
    }

    public function store(Request $request)
    {
        abort_unless($request->user()->can('inventory.manage'), 403);

        $data = $request->validate(['name' => ['required', 'string', 'max:255']]);

        return ItemCategory::create($data);
    }
}
