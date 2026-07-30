<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Item;
use App\Models\PurchaseInvoiceLine;
use App\Models\StockMovement;
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

    public function destroy(Request $request, Item $item)
    {
        abort_unless($request->user()->can('inventory.manage'), 403);

        // purchase_invoice_lines/stock_movements cascade-delete on item_id
        // at the DB level — those are real purchasing/stock history, so
        // block on them rather than silently wiping a supplier's invoice
        // lines. lots/supplierPrices/price history are just item metadata,
        // safe to let go with it.
        abort_if(
            PurchaseInvoiceLine::where('item_id', $item->id)->exists()
                || StockMovement::where('item_id', $item->id)->exists(),
            422,
            'هذا الصنف له فواتير شراء أو حركة مخزون مسجّلة — لا يمكن حذفه نهائياً حفاظاً على السجل. عطّله من "تعديل" بدلاً من ذلك.',
        );

        $item->delete();

        return response()->noContent();
    }
}
