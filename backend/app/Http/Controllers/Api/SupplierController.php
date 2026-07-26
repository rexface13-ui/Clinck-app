<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use App\Models\Supplier;
use App\Models\SupplierTransaction;
use App\Services\SupplierService;
use Illuminate\Http\Request;

class SupplierController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('suppliers.view'), 403);

        $suppliers = Supplier::orderBy('name')->get();

        // One grouped query for every supplier's running balance instead of
        // an N+1 ledger() call per card — purchases/check_bounced already
        // carry a positive amount_ils and payments/check_endorsed a
        // negative one (see SupplierService), so a plain sum is the balance.
        $balances = SupplierTransaction::whereIn('supplier_id', $suppliers->pluck('id'))
            ->selectRaw('supplier_id, SUM(amount_ils) as total')
            ->groupBy('supplier_id')
            ->pluck('total', 'supplier_id');

        return $suppliers->map(fn ($s) => [
            ...$s->toArray(),
            'outstanding_ils' => round((float) ($balances[$s->id] ?? 0), 2),
        ]);
    }

    public function store(Request $request)
    {
        abort_unless($request->user()->can('suppliers.manage'), 403);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:50'],
        ]);

        return Supplier::create($data);
    }

    public function update(Request $request, Supplier $supplier)
    {
        abort_unless($request->user()->can('suppliers.manage'), 403);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:50'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $supplier->update($data);

        return $supplier;
    }

    public function show(Request $request, Supplier $supplier)
    {
        abort_unless($request->user()->can('suppliers.view'), 403);

        return $supplier;
    }

    /**
     * Unified ILS ledger — same running-balance style as
     * PatientBillingController::ledger(). Purchases and check_bounced
     * increase what's owed; payments and check_endorsed reduce it.
     */
    public function ledger(Request $request, Supplier $supplier)
    {
        abort_unless($request->user()->can('suppliers.view'), 403);

        $transactions = $supplier->transactions()->orderBy('occurred_at')->get();

        $running = 0;
        $rows = $transactions->map(function ($t) use (&$running) {
            $running += (float) $t->amount_ils;

            return [
                'id' => $t->id,
                'type' => $t->type,
                'reference_type' => $t->reference_type,
                'reference_id' => $t->reference_id,
                'amount_ils' => $t->amount_ils,
                'balance_after_ils' => round($running, 2),
                'occurred_at' => display_datetime($t->occurred_at),
            ];
        });

        return [
            'outstanding_ils' => round($running, 2),
            'transactions' => $rows->reverse()->values(),
        ];
    }

    public function pay(Request $request, Supplier $supplier, SupplierService $supplierService)
    {
        abort_unless($request->user()->can('suppliers.manage'), 403);

        $data = $request->validate([
            'cashbox_id' => ['required', 'exists:cashboxes,id'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'currency' => ['required', 'string', 'size:3'],
            'exchange_rate' => ['nullable', 'numeric', 'min:0.000001'],
        ]);

        $cashbox = Cashbox::findOrFail($data['cashbox_id']);

        $transaction = $supplierService->pay(
            supplier: $supplier,
            cashbox: $cashbox,
            amount: (float) $data['amount'],
            currency: $data['currency'],
            exchangeRate: (float) ($data['exchange_rate'] ?? 1),
            cashboxService: app(\App\Services\CashboxService::class),
        );

        return $transaction;
    }
}
