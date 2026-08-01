<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Item;
use App\Models\ItemPriceHistory;
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
            'default_price' => ['nullable', 'numeric', 'min:0'],
            'default_currency' => ['nullable', 'string', 'size:3'],
        ]);

        $data['unit'] = $data['unit'] ?? 'piece';
        if (! empty($data['default_price'])) {
            $data['default_currency'] = $data['default_currency'] ?? 'ILS';
        }

        $item = Item::create($data);

        if (! empty($data['default_price'])) {
            $this->logDefaultPrice($item, $data['default_price'], $data['default_currency']);
        }

        return $item->load('category');
    }

    public function update(Request $request, Item $item)
    {
        abort_unless($request->user()->can('inventory.manage'), 403);

        $data = $request->validate([
            'item_category_id' => ['nullable', 'exists:item_categories,id'],
            'name' => ['sometimes', 'string', 'max:255'],
            'type' => ['sometimes', Rule::in(['direct_expense', 'simple_stock', 'tracked'])],
            'unit' => ['sometimes', 'string', 'max:50'],
            'default_price' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'default_currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        // A changed price is worth logging even if the rest of the item's
        // metadata is untouched — that's the whole point of a price history.
        $priceChanged = array_key_exists('default_price', $data)
            && (float) ($data['default_price'] ?? 0) !== (float) ($item->default_price ?? 0);

        if (array_key_exists('default_price', $data) && ! empty($data['default_price'])) {
            $data['default_currency'] = $data['default_currency'] ?? $item->default_currency ?? 'ILS';
        }

        $item->update($data);

        if ($priceChanged && ! empty($item->default_price)) {
            $this->logDefaultPrice($item, $item->default_price, $item->default_currency ?? 'ILS');
        }

        return $item->load('category');
    }

    /** No supplier/invoice attached — this is the item's own default price, not a purchase. */
    private function logDefaultPrice(Item $item, float $price, string $currency): void
    {
        ItemPriceHistory::create([
            'clinic_id' => $item->clinic_id,
            'item_id' => $item->id,
            'supplier_id' => null,
            'price' => $price,
            'currency' => $currency,
            'purchase_invoice_id' => null,
            'recorded_at' => now(),
        ]);
    }

    public function show(Request $request, Item $item)
    {
        abort_unless($request->user()->can('inventory.view'), 403);

        return $item->load(['category', 'lots', 'supplierPrices']);
    }

    public function priceHistory(Request $request, Item $item)
    {
        abort_unless($request->user()->can('inventory.view'), 403);

        return $item->priceHistory()->with('supplier')->orderByDesc('recorded_at')->get()->map(fn (ItemPriceHistory $h) => [
            'id' => $h->id,
            'price' => $h->price,
            'currency' => $h->currency,
            'supplier_name' => $h->supplier?->name,
            'recorded_at' => display_datetime($h->recorded_at),
        ]);
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
