<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\CheckModel;
use App\Models\Item;
use App\Models\ItemLot;
use App\Models\ItemPriceHistory;
use App\Models\ItemSupplierPrice;
use App\Models\PurchaseInvoice;
use App\Models\PurchaseInvoiceLine;
use App\Models\StockMovement;
use App\Models\SupplierTransaction;
use App\Services\CashboxService;
use App\Services\CheckService;
use App\Services\PurchaseInvoiceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

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

    /**
     * Metadata-only edit (invoice number, issue date, notes) — always
     * allowed regardless of status. Line items are edited via
     * addLine/removeLine, which stay draft-only.
     */
    public function update(Request $request, PurchaseInvoice $purchaseInvoice)
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);

        $data = $request->validate([
            'invoice_number' => ['sometimes', 'nullable', 'string', 'max:255'],
            'issued_at' => ['sometimes', 'date'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $purchaseInvoice->update($data);

        return $purchaseInvoice->fresh(['lines.item', 'lines.itemLot', 'supplier', 'branch']);
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

    /**
     * Confirming moves stock regardless of payment method (that part is
     * unconditional). "credit" is the default and needs nothing further —
     * the purchase transaction service->confirm() already posts is exactly
     * the debt. "cash" additionally pays the supplier immediately from a
     * cashbox; "check" issues an outgoing check to the supplier — which,
     * matching how every other check in this app behaves, only reduces the
     * debt once it actually clears (or adds back if it bounces), not at
     * the moment it's handed over.
     *
     * The cash payment is posted directly here (not via SupplierService::pay)
     * so both the supplier_transaction and the cashbox_transaction can be
     * tagged reference_type=purchase_invoice — that's what lets revert()
     * find and undo exactly this invoice's payment later, without touching
     * any other payment made to the same supplier.
     */
    public function confirm(
        Request $request,
        PurchaseInvoice $purchaseInvoice,
        PurchaseInvoiceService $service,
        CheckService $checkService,
        CashboxService $cashboxService,
    ) {
        abort_unless($request->user()->can('purchasing.manage'), 403);

        $data = $request->validate([
            'payment_method' => ['sometimes', Rule::in(['credit', 'cash', 'check'])],
            'cashbox_id' => ['required_if:payment_method,cash', 'nullable', 'exists:cashboxes,id'],
            'check_number' => ['required_if:payment_method,check', 'nullable', 'string', 'max:255'],
            'bank_name' => ['nullable', 'string', 'max:255'],
            'due_date' => ['required_if:payment_method,check', 'nullable', 'date'],
        ]);

        $invoice = $service->confirm($purchaseInvoice);
        $paymentMethod = $data['payment_method'] ?? 'credit';

        if ($paymentMethod === 'cash') {
            $cashbox = Cashbox::findOrFail($data['cashbox_id']);
            abort_if($cashbox->currency !== 'ILS', 422, 'دفع فواتير الشراء نقداً متاح فقط من صندوق شيكل حالياً.');

            DB::transaction(function () use ($invoice, $cashbox, $cashboxService) {
                $transaction = SupplierTransaction::create([
                    'clinic_id' => $invoice->clinic_id,
                    'supplier_id' => $invoice->supplier_id,
                    'type' => 'payment',
                    'reference_type' => 'purchase_invoice',
                    'reference_id' => $invoice->id,
                    'amount_ils' => -(float) $invoice->total_amount_ils,
                    'occurred_at' => now(),
                ]);

                $cashboxService->record($cashbox, 'expense_out', 'purchase_invoice', $invoice->id, -(float) $invoice->total_amount_ils);

                return $transaction;
            });
        } elseif ($paymentMethod === 'check') {
            $check = $checkService->receive(
                direction: 'outgoing',
                partyType: 'supplier',
                partyId: $invoice->supplier_id,
                checkNumber: $data['check_number'],
                bankName: $data['bank_name'] ?? null,
                amount: (float) $invoice->total_amount_ils,
                currency: 'ILS',
                dueDate: $data['due_date'],
            );
            $check->update(['purchase_invoice_id' => $invoice->id]);
        }

        return $invoice->fresh(['lines.item', 'lines.itemLot', 'supplier', 'branch']);
    }

    /**
     * Undo everything confirm() (and its payment, if any) did, and put the
     * invoice back to "draft" — its lines stay as-is and stay editable, so
     * the normal add/remove-line + confirm flow re-applies the corrected
     * amounts and payment from scratch. Nothing here can silently leave the
     * books wrong: an outgoing check that already cleared or bounced blocks
     * the revert entirely, since undoing it would misrepresent money that
     * has genuinely already moved.
     */
    public function revert(Request $request, PurchaseInvoice $purchaseInvoice)
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);
        abort_unless($purchaseInvoice->status === 'confirmed', 422, 'الفاتورة مسودة أصلاً.');

        $check = CheckModel::where('purchase_invoice_id', $purchaseInvoice->id)->first();
        abort_if(
            $check && in_array($check->status, ['cleared', 'bounced'], true),
            422,
            'الشيك المرتبط بهاي الفاتورة تحصّل أو رجع فعلياً — عالجه من صفحة الشيكات قبل تعديل الفاتورة.',
        );

        DB::transaction(function () use ($purchaseInvoice, $check) {
            $this->reverseConfirmationEffects($purchaseInvoice, $check);
            $purchaseInvoice->update(['status' => 'draft']);
        });

        return $purchaseInvoice->fresh(['lines.item', 'lines.itemLot', 'supplier', 'branch']);
    }

    public function destroy(Request $request, PurchaseInvoice $purchaseInvoice)
    {
        abort_unless($request->user()->can('purchasing.manage'), 403);

        if ($purchaseInvoice->status === 'confirmed') {
            $check = CheckModel::where('purchase_invoice_id', $purchaseInvoice->id)->first();
            abort_if(
                $check && in_array($check->status, ['cleared', 'bounced'], true),
                422,
                'الشيك المرتبط بهاي الفاتورة تحصّل أو رجع فعلياً — عالجه من صفحة الشيكات قبل حذف الفاتورة.',
            );

            DB::transaction(function () use ($purchaseInvoice, $check) {
                $this->reverseConfirmationEffects($purchaseInvoice, $check);
                $purchaseInvoice->delete();
            });
        } else {
            $purchaseInvoice->delete();
        }

        return response()->noContent();
    }

    /**
     * Shared by revert() and destroy(): removes every trace confirm() left
     * behind — the stock movements, the item lots it created (nothing in
     * this app ever consumes from a lot, so deleting is always safe), the
     * supplier debt entry, and whatever payment was made (cash reversed via
     * a cashbox adjustment back in; an unresolved outgoing check simply
     * cancelled, since it never touched the books until clear/bounce).
     */
    private function reverseConfirmationEffects(PurchaseInvoice $invoice, ?CheckModel $check): void
    {
        $invoice->load('lines');

        foreach ($invoice->lines as $line) {
            if ($line->item_lot_id) {
                ItemLot::where('id', $line->item_lot_id)->delete();
                $line->update(['item_lot_id' => null]);
            }
        }

        StockMovement::where('reference_type', 'purchase_invoice')->where('reference_id', $invoice->id)->delete();
        ItemPriceHistory::where('purchase_invoice_id', $invoice->id)->delete();

        $paymentTransaction = SupplierTransaction::where('reference_type', 'purchase_invoice')
            ->where('reference_id', $invoice->id)
            ->where('type', 'payment')
            ->first();

        if ($paymentTransaction) {
            $cashboxTransaction = CashboxTransaction::where('reference_type', 'purchase_invoice')
                ->where('reference_id', $invoice->id)
                ->where('type', 'expense_out')
                ->first();

            if ($cashboxTransaction) {
                $cashbox = Cashbox::find($cashboxTransaction->cashbox_id);
                if ($cashbox) {
                    app(CashboxService::class)->record($cashbox, 'adjustment', 'purchase_invoice', $invoice->id, (float) $invoice->total_amount_ils);
                }
            }

            $paymentTransaction->delete();
        }

        if ($check && $check->status === 'in_wallet') {
            $check->delete();
        }

        SupplierTransaction::where('reference_type', 'purchase_invoice')
            ->where('reference_id', $invoice->id)
            ->where('type', 'purchase')
            ->delete();
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
