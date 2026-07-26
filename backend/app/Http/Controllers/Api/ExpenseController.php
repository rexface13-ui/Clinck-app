<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Services\CashboxService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ExpenseController extends Controller
{
    public function categories(Request $request)
    {
        abort_unless($request->user()->can('cash.view'), 403);

        return ExpenseCategory::orderBy('name')->get();
    }

    public function storeCategory(Request $request)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        $data = $request->validate(['name' => ['required', 'string', 'max:255']]);

        return ExpenseCategory::create($data);
    }

    public function index(Request $request)
    {
        abort_unless($request->user()->can('cash.view'), 403);

        $query = Expense::with(['category', 'cashbox'])->orderByDesc('spent_at');

        if ($request->filled('from')) $query->whereDate('spent_at', '>=', $request->date('from'));
        if ($request->filled('to')) $query->whereDate('spent_at', '<=', $request->date('to'));
        if ($request->filled('expense_category_id')) $query->where('expense_category_id', $request->integer('expense_category_id'));
        if ($request->filled('cashbox_id')) $query->where('cashbox_id', $request->integer('cashbox_id'));
        if ($request->filled('search')) {
            $term = $request->string('search');
            $query->where(function ($q) use ($term) {
                $q->where('description', 'like', "%{$term}%")
                    ->orWhereHas('category', fn ($c) => $c->where('name', 'like', "%{$term}%"));
            });
        }

        return $query->limit(500)->get()->map(fn ($e) => [
            'id' => $e->id,
            'expense_category_id' => $e->expense_category_id,
            'category' => $e->category->name,
            'cashbox_id' => $e->cashbox_id,
            'cashbox' => $e->cashbox->name,
            'amount' => $e->amount,
            'currency' => $e->currency,
            'amount_ils' => $e->amount_ils,
            'description' => $e->description,
            'spent_at' => display_datetime($e->spent_at),
        ]);
    }

    public function store(Request $request, CashboxService $cashboxService)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        $data = $request->validate([
            'expense_category_id' => ['required', Rule::exists('expense_categories', 'id')],
            'cashbox_id' => ['required', Rule::exists('cashboxes', 'id')],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'description' => ['nullable', 'string', 'max:255'],
        ]);

        $cashbox = Cashbox::findOrFail($data['cashbox_id']);

        $expense = DB::transaction(function () use ($data, $cashbox, $cashboxService) {
            $expense = Expense::create([
                'expense_category_id' => $data['expense_category_id'],
                'cashbox_id' => $cashbox->id,
                'amount' => $data['amount'],
                'currency' => $cashbox->currency,
                // Simplification: no FX conversion for expenses/incomes yet
                // (only patient payments carry an exchange_rate per spec).
                // Fine while every cashbox is ILS; revisit if a foreign
                // cashbox is ever created.
                'amount_ils' => $data['amount'],
                'description' => $data['description'] ?? null,
                'spent_at' => now(),
            ]);

            $cashboxService->record($cashbox, 'expense_out', 'expense', $expense->id, -$data['amount']);

            return $expense;
        });

        return $expense->load(['category', 'cashbox']);
    }

    public function update(Request $request, Expense $expense, CashboxService $cashboxService)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        $data = $request->validate([
            'expense_category_id' => ['required', Rule::exists('expense_categories', 'id')],
            'cashbox_id' => ['required', Rule::exists('cashboxes', 'id')],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'description' => ['nullable', 'string', 'max:255'],
        ]);

        $newCashbox = Cashbox::findOrFail($data['cashbox_id']);

        DB::transaction(function () use ($data, $expense, $newCashbox, $cashboxService) {
            // Reverse the original movement on its original cashbox, then
            // apply the (possibly different) new amount/cashbox — same
            // pattern as destroy(), just followed by a fresh charge instead
            // of stopping there.
            $cashboxService->record($expense->cashbox, 'adjustment', 'expense', $expense->id, (float) $expense->amount);
            // Old and new cashbox may be the very same row (editing just the
            // amount/category) — refresh so this second write isn't based on
            // the stale in-memory balance from before the reversal above.
            $newCashbox->refresh();
            $cashboxService->record($newCashbox, 'expense_out', 'expense', $expense->id, -$data['amount']);

            $expense->update([
                'expense_category_id' => $data['expense_category_id'],
                'cashbox_id' => $newCashbox->id,
                'amount' => $data['amount'],
                'currency' => $newCashbox->currency,
                'amount_ils' => $data['amount'],
                'description' => $data['description'] ?? null,
            ]);
        });

        return $expense->fresh(['category', 'cashbox']);
    }

    public function destroy(Request $request, Expense $expense, CashboxService $cashboxService)
    {
        abort_unless($request->user()->can('cash.manage'), 403);

        DB::transaction(function () use ($expense, $cashboxService) {
            $cashboxService->record($expense->cashbox, 'adjustment', 'expense', $expense->id, (float) $expense->amount);
            $expense->delete();
        });

        return response()->noContent();
    }
}
