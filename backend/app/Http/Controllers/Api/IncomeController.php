<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use App\Models\Income;
use App\Models\IncomeCategory;
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

    public function index(Request $request)
    {
        abort_unless($request->user()->can('cash.view'), 403);

        return Income::with(['category', 'cashbox'])->orderByDesc('received_at')->limit(200)->get()->map(fn ($i) => [
            'id' => $i->id,
            'income_category_id' => $i->income_category_id,
            'category' => $i->category->name,
            'cashbox_id' => $i->cashbox_id,
            'cashbox' => $i->cashbox->name,
            'amount' => $i->amount,
            'currency' => $i->currency,
            'amount_ils' => $i->amount_ils,
            'description' => $i->description,
            'received_at' => display_datetime($i->received_at),
        ]);
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
