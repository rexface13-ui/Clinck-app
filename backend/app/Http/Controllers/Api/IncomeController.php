<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\Payment;
use App\Services\CashboxService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class IncomeController extends Controller
{
    public function categories(Request $request)
    {
        abort_unless($request->user()->can('cash.view'), 403);

        return IncomeCategory::orderBy('name')->get();
    }

    public function storeCategory(Request $request)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        $data = $request->validate(['name' => ['required', 'string', 'max:255']]);

        return IncomeCategory::create($data);
    }

    /**
     * "الوارد" unifies two sources that both move money into a cashbox:
     * manual income entries (the Income model) and patient payment
     * collections (PaymentService::collect) — both write a CashboxTransaction
     * row, so reading from there instead of the Income table alone is what
     * actually makes patient payments show up here.
     */
    public function index(Request $request)
    {
        abort_unless($request->user()->can('cash.view'), 403);

        $query = CashboxTransaction::with('cashbox')
            ->whereIn('type', ['income_in', 'payment_in'])
            ->orderByDesc('occurred_at');

        if ($request->filled('from')) $query->whereDate('occurred_at', '>=', $request->date('from'));
        if ($request->filled('to')) $query->whereDate('occurred_at', '<=', $request->date('to'));
        if ($request->filled('cashbox_id')) $query->where('cashbox_id', $request->integer('cashbox_id'));
        if ($request->filled('kind')) {
            $query->where('type', $request->input('kind') === 'payment' ? 'payment_in' : 'income_in');
        }

        $transactions = $query->limit(500)->get();

        $incomesById = Income::with('category')
            ->whereIn('id', $transactions->where('type', 'income_in')->pluck('reference_id'))
            ->get()->keyBy('id');
        $paymentsById = Payment::with('patient')
            ->whereIn('id', $transactions->where('type', 'payment_in')->pluck('reference_id'))
            ->get()->keyBy('id');

        $methodLabels = ['cash' => 'نقدي', 'card' => 'بطاقة', 'transfer' => 'تحويل'];

        $rows = $transactions->map(function ($t) use ($incomesById, $paymentsById, $methodLabels) {
            if ($t->type === 'income_in') {
                $income = $incomesById->get($t->reference_id);

                return [
                    'id' => $t->id,
                    'kind' => 'income',
                    'source_id' => $income?->id,
                    'income_category_id' => $income?->income_category_id,
                    'category' => $income?->category?->name ?? 'وارد يدوي',
                    'cashbox_id' => $t->cashbox_id,
                    'cashbox' => $t->cashbox->name,
                    'amount' => $income?->amount ?? (string) $t->amount,
                    'currency' => $income?->currency ?? $t->cashbox->currency,
                    'amount_ils' => $income?->amount_ils ?? (string) $t->amount,
                    'description' => $income?->description,
                    'received_at' => display_datetime($t->occurred_at),
                    'editable' => true,
                ];
            }

            $payment = $paymentsById->get($t->reference_id);

            return [
                'id' => $t->id,
                'kind' => 'payment',
                'source_id' => $payment?->id,
                'income_category_id' => null,
                'category' => 'تحصيل من مريض',
                'cashbox_id' => $t->cashbox_id,
                'cashbox' => $t->cashbox->name,
                'amount' => $payment?->amount ?? (string) $t->amount,
                'currency' => $payment?->currency ?? $t->cashbox->currency,
                'amount_ils' => $payment?->amount_ils ?? (string) $t->amount,
                'description' => trim(($payment?->patient?->full_name ?? 'مريض محذوف') . ' — ' . ($methodLabels[$payment?->method] ?? $payment?->method ?? '')),
                'received_at' => display_datetime($t->occurred_at),
                'editable' => false,
            ];
        });

        if ($request->filled('search')) {
            $term = mb_strtolower((string) $request->input('search'));
            $rows = $rows->filter(
                fn ($r) => str_contains(mb_strtolower($r['category']), $term)
                    || str_contains(mb_strtolower($r['description'] ?? ''), $term)
                    || str_contains(mb_strtolower($r['cashbox']), $term),
            );
        }

        return $rows->values();
    }

    public function store(Request $request, CashboxService $cashboxService)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        $data = $request->validate([
            'income_category_id' => ['required', Rule::exists('income_categories', 'id')],
            'cashbox_id' => ['required', Rule::exists('cashboxes', 'id')],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'description' => ['nullable', 'string', 'max:255'],
        ]);

        $cashbox = Cashbox::findOrFail($data['cashbox_id']);

        $income = DB::transaction(function () use ($data, $cashbox, $cashboxService) {
            $income = Income::create([
                'income_category_id' => $data['income_category_id'],
                'cashbox_id' => $cashbox->id,
                'amount' => $data['amount'],
                'currency' => $cashbox->currency,
                'amount_ils' => $data['amount'],
                'description' => $data['description'] ?? null,
                'received_at' => now(),
            ]);

            $cashboxService->record($cashbox, 'income_in', 'income', $income->id, $data['amount']);

            return $income;
        });

        return $income->load(['category', 'cashbox']);
    }

    public function update(Request $request, Income $income, CashboxService $cashboxService)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        $data = $request->validate([
            'income_category_id' => ['required', Rule::exists('income_categories', 'id')],
            'cashbox_id' => ['required', Rule::exists('cashboxes', 'id')],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'description' => ['nullable', 'string', 'max:255'],
        ]);

        $newCashbox = Cashbox::findOrFail($data['cashbox_id']);

        DB::transaction(function () use ($data, $income, $newCashbox, $cashboxService) {
            $cashboxService->record($income->cashbox, 'adjustment', 'income', $income->id, -(float) $income->amount);
            // Old and new cashbox may be the same row — refresh so this
            // second write isn't based on the stale in-memory balance from
            // before the reversal above.
            $newCashbox->refresh();
            $cashboxService->record($newCashbox, 'income_in', 'income', $income->id, $data['amount']);

            $income->update([
                'income_category_id' => $data['income_category_id'],
                'cashbox_id' => $newCashbox->id,
                'amount' => $data['amount'],
                'currency' => $newCashbox->currency,
                'amount_ils' => $data['amount'],
                'description' => $data['description'] ?? null,
            ]);
        });

        return $income->fresh(['category', 'cashbox']);
    }

    public function destroy(Request $request, Income $income, CashboxService $cashboxService)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        DB::transaction(function () use ($income, $cashboxService) {
            $cashboxService->record($income->cashbox, 'adjustment', 'income', $income->id, -(float) $income->amount);
            $income->delete();
        });

        return response()->noContent();
    }
}
