<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Item;
use App\Models\ItemSupplierPrice;
use App\Models\PurchaseInvoice;
use App\Models\PurchaseInvoiceLine;
use App\Services\PurchaseInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PurchaseInvoiceController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('purchasing.view'), 403);

        $query = PurchaseInvoice::with(['supplier', 'branch', 'lines.item'])->orderByDesc('issued_at');

        if ($request->filled('supplier_id')) {
            $query->where('supplier_id', $request->input('supplier_id'));
        }

        return $query->get();
    }

    public function store(Request $request)
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);

        $data = $request->validate([
            'supplier_id' => ['required', 'exists:suppliers,id'],
            'branch_id' => ['required', 'exists:branches,id'],
            'invoice_number' => ['nullable', 'string', 'max:255'],
        ]);

        $invoice = PurchaseInvoice::create($data + [
            'status' => 'draft',
            'total_amount_ils' => 0,
            'issued_at' => now(),
        ]);

        return $invoice->load(['supplier', 'branch', 'lines.item']);
    }

    public function show(Request $request, PurchaseInvoice $purchaseInvoice)
    {
        abort_unless($request->user()->can('purchasing.view'), 403);

        return $purchaseInvoice->load(['supplier', 'branch', 'lines.item', 'lines.itemLot']);
    }

    public function addLine(Request $request, PurchaseInvoice $purchaseInvoice)
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);
        abort_unless($purchaseInvoice->status === 'draft', 422, 'الفاتورة مؤكدة مسبقاً.');

        $data = $request->validate([
            'item_id' => ['required', 'exists:items,id'],
            'quantity' => ['required', 'numeric', 'min:0.001'],
            'unit_price' => ['required', 'numeric', 'min:0'],
            'currency' => ['required', 'string', 'size:3'],
            'lot_number' => ['nullable', 'string', 'max:255'],
            'expiry_date' => ['nullable', 'date'],
        ]);

        $item = Item::findOrFail($data['item_id']);
        $amountIls = round($data['quantity'] * $data['unit_price'], 2);

        $line = DB::transaction(function () use ($purchaseInvoice, $data, $amountIls) {
            $line = PurchaseInvoiceLine::create([
                'purchase_invoice_id' => $purchaseInvoice->id,
                'item_id' => $data['item_id'],
                'quantity' => $data['quantity'],
                'unit_price' => $data['unit_price'],
                'currency' => $data['currency'],
                'amount_ils' => $amountIls,
                'lot_number' => $data['lot_number'] ?? null,
                'expiry_date' => $data['expiry_date'] ?? null,
            ]);

            $purchaseInvoice->update([
                'total_amount_ils' => $purchaseInvoice->lines()->sum('amount_ils'),
            ]);

            return $line;
        });

        return $line->load('item');
    }

    public function removeLine(Request $request, PurchaseInvoice $purchaseInvoice, PurchaseInvoiceLine $line)
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);
        abort_unless($purchaseInvoice->status === 'draft', 422, 'الفاتورة مؤكدة مسبقاً.');
        abort_unless($line->purchase_invoice_id === $purchaseInvoice->id, 404);

        $line->delete();
        $purchaseInvoice->update(['total_amount_ils' => $purchaseInvoice->lines()->sum('amount_ils')]);

        return response()->noContent();
    }

    public function confirm(Request $request, PurchaseInvoice $purchaseInvoice, PurchaseInvoiceService $service)
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);

        return $service->confirm($purchaseInvoice);
    }

    public function destroy(Request $request, PurchaseInvoice $purchaseInvoice)
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);
        abort_unless($purchaseInvoice->status === 'draft', 422, 'لا يمكن حذف فاتورة مؤكدة.');

        $purchaseInvoice->delete();

        return response()->noContent();
    }

    public function lastPrice(Request $request)
    {
        abort_unless($request->user()->can('purchasing.view'), 403);

        $data = $request->validate([
            'item_id' => ['required', 'exists:items,id'],
            'supplier_id' => ['required', 'exists:suppliers,id'],
        ]);

        $price = ItemSupplierPrice::where('item_id', $data['item_id'])
            ->where('supplier_id', $data['supplier_id'])
            ->first();

        return $price ?: response()->json(null);
    }
}
