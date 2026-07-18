<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Item;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ItemController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('inventory.view'), 403);

        $query = Item::with('category')->orderBy('name');

        if ($request->filled('item_category_id')) {
            $query->where('item_category_id', $request->input('item_category_id'));
        }

        return $query->get();
    }

    public function store(Request $request)
    {
        abort_unless($request->user()->can('inventory.manage'), 403);

        $data = $request->validate([
            'item_category_id' => ['nullable', 'exists:item_categories,id'],
            'name' => ['required', 'string', 'max:255'],
            'type' => ['required', Rule::in(['direct_expense', 'simple_stock', 'tracked'])],
            'unit' => ['nullable', 'string', 'max:50'],
        ]);

        $data['unit'] = $data['unit'] ?? 'piece';

        return Item::create($data)->load('category');
    }

    public function update(Request $request, Item $item)
    {
        abort_unless($request->user()->can('inventory.manage'), 403);

        $data = $request->validate([
            'item_category_id' => ['nullable', 'exists:item_categories,id'],
            'name' => ['sometimes', 'string', 'max:255'],
            'type' => ['sometimes', Rule::in(['direct_expense', 'simple_stock', 'tracked'])],
            'unit' => ['sometimes', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $item->update($data);

        return $item->load('category');
    }

    public function show(Request $request, Item $item)
    {
        abort_unless($request->user()->can('inventory.view'), 403);

        return $item->load(['category', 'lots', 'supplierPrices']);
    }
}
