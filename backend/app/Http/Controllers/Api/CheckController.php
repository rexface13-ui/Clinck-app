<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use App\Models\CheckModel;
use App\Models\Supplier;
use App\Models\TelegramLink;
use App\Services\CashboxService;
use App\Services\CheckService;
use App\Services\TelegramService;
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
            'image2' => ['nullable', 'image', 'max:5120'],
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
            image2: $request->file('image2'),
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

    public function storeImage(Request $request, CheckModel $check, CheckService $checkService)
    {
        abort_unless($request->user()->can('checks.manage'), 403);

        $data = $request->validate([
            'image' => ['required', 'image', 'max:5120'],
            'slot' => ['nullable', 'integer', Rule::in([1, 2])],
        ]);

        return $checkService->attachImage($check, $request->file('image'), (int) ($data['slot'] ?? 1));
    }

    /**
     * Pings a linked staff member on Telegram asking them to reply with a
     * photo of this check — their next photo message gets auto-attached
     * (see TelegramPoll::handleCheckPhotoReply).
     */
    public function requestImage(Request $request, CheckModel $check, TelegramService $telegram)
    {
        abort_unless($request->user()->can('checks.manage'), 403);

        $data = $request->validate([
            'user_id' => ['required_without:doctor_id', 'nullable', 'exists:users,id'],
            'doctor_id' => ['required_without:user_id', 'nullable', 'exists:doctors,id'],
            'slots' => ['nullable', 'array', 'min:1'],
            'slots.*' => ['integer', Rule::in([1, 2])],
        ]);

        $link = $data['doctor_id'] ?? null
            ? TelegramLink::where('doctor_id', $data['doctor_id'])->whereNotNull('linked_at')->first()
            : TelegramLink::where('user_id', $data['user_id'])->whereNotNull('linked_at')->first();
        abort_unless($link, 422, 'هذا الشخص مو مربوط بتيليغرام بعد.');

        $slots = ! empty($data['slots']) ? array_values(array_unique($data['slots'])) : [1];
        sort($slots);
        $link->update(['pending_check_id' => $check->id, 'pending_check_slots' => implode(',', $slots)]);

        $side = count($slots) > 1 ? 'وجه وظهر' : ($slots[0] === 2 ? 'ظهر' : 'وجه');
        $telegram->sendMessage(
            (int) $link->telegram_chat_id,
            "📸 مطلوب صورة {$side} الشيك رقم {$check->check_number} ({$check->amount} {$check->currency}) — صوّرها أو اختارها من المعرض وابعتها هون مباشرة."
                . (count($slots) > 1 ? ' (ابعت أول صورة للوجه وبعدها صورة للظهر)' : ''),
        );

        return response()->noContent();
    }

    public function image(Request $request, CheckModel $check)
    {
        abort_unless($request->user()->can('checks.view'), 403);

        $slot = (int) $request->query('slot', 1);
        $path = $slot === 2 ? $check->image_path_2 : $check->image_path;
        abort_unless($path, 404);

        return response()->file(\Illuminate\Support\Facades\Storage::disk('local')->path($path));
    }
}
