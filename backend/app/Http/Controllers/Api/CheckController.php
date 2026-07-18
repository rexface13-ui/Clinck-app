<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use App\Models\CheckModel;
use App\Models\Supplier;
use App\Services\CashboxService;
use App\Services\CheckService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CheckController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('checks.view'), 403);

        $query = CheckModel::with('events')->orderByDesc('received_at');

        if ($request->filled('direction')) {
            $query->where('direction', $request->input('direction'));
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        return $query->get();
    }

    public function store(Request $request, CheckService $checkService)
    {
        abort_unless($request->user()->can('checks.manage'), 403);

        $data = $request->validate([
            'direction' => ['required', Rule::in(['incoming', 'outgoing'])],
            'party_type' => ['required', Rule::in(['patient', 'supplier'])],
            'party_id' => ['required', 'integer'],
            'check_number' => ['required', 'string', 'max:255'],
            'bank_name' => ['nullable', 'string', 'max:255'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'currency' => ['required', 'string', 'size:3'],
            'due_date' => ['required', 'date'],
            'image' => ['nullable', 'image', 'max:5120'],
        ]);

        return $checkService->receive(
            direction: $data['direction'],
            partyType: $data['party_type'],
            partyId: $data['party_id'],
            checkNumber: $data['check_number'],
            bankName: $data['bank_name'] ?? null,
            amount: (float) $data['amount'],
            currency: $data['currency'],
            dueDate: $data['due_date'],
            image: $request->file('image'),
        );
    }

    public function endorse(Request $request, CheckModel $check, CheckService $checkService)
    {
        abort_unless($request->user()->can('checks.manage'), 403);

        $data = $request->validate(['supplier_id' => ['required', 'exists:suppliers,id']]);
        $supplier = Supplier::findOrFail($data['supplier_id']);

        return $checkService->endorse($check, $supplier);
    }

    public function bounce(Request $request, CheckModel $check, CheckService $checkService)
    {
        abort_unless($request->user()->can('checks.manage'), 403);

        return $checkService->bounce($check);
    }

    public function clear(Request $request, CheckModel $check, CheckService $checkService, CashboxService $cashboxService)
    {
        abort_unless($request->user()->can('checks.manage'), 403);

        $data = $request->validate(['cashbox_id' => ['nullable', 'exists:cashboxes,id']]);
        $cashbox = ! empty($data['cashbox_id']) ? Cashbox::findOrFail($data['cashbox_id']) : null;

        return $checkService->clear($check, $cashbox, $cashboxService);
    }

    public function image(Request $request, CheckModel $check)
    {
        abort_unless($request->user()->can('checks.view'), 403);
        abort_unless($check->image_path, 404);

        return response()->file(\Illuminate\Support\Facades\Storage::disk('local')->path($check->image_path));
    }
}
