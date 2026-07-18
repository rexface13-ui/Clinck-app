<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StockMovement;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class StockMovementController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('inventory.view'), 403);

        $query = StockMovement::with(['item', 'branch'])->orderByDesc('occurred_at');

        if ($request->filled('item_id')) {
            $query->where('item_id', $request->input('item_id'));
        }

        return $query->limit(200)->get();
    }

    /**
     * Only manual_out and adjustment are accepted here — purchase_in only
     * ever comes from PurchaseInvoiceService::confirm().
     */
    public function store(Request $request)
    {
        abort_unless($request->user()->can('inventory.manage'), 403);

        $data = $request->validate([
            'branch_id' => ['required', 'exists:branches,id'],
            'item_id' => ['required', 'exists:items,id'],
            'item_lot_id' => ['nullable', 'exists:item_lots,id'],
            'type' => ['required', Rule::in(['manual_out', 'adjustment'])],
            'quantity' => ['required', 'numeric'],
        ]);

        if ($data['type'] === 'manual_out') {
            $data['quantity'] = -abs($data['quantity']);
        }

        $movement = StockMovement::create($data + ['occurred_at' => now()]);

        return $movement->load(['item', 'branch']);
    }
}
