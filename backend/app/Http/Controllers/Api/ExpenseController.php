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

        return Expense::with(['category', 'cashbox'])->orderByDesc('spent_at')->limit(200)->get()->map(fn ($e) => [
            'id' => $e->id,
            'category' => $e->category->name,
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
}
