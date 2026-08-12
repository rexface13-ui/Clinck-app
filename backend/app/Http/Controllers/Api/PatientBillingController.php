<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Billing\StorePaymentRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\PaymentResource;
use App\Models\Cashbox;
use App\Models\CheckModel;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Note;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Models\WorkItemToothStep;
use App\Services\PaymentService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PatientBillingController extends Controller
{
    protected function requireBillingView(Request $request): void
    {
        abort_unless($request->user()->can('billing.view'), 403);
    }

    public function invoices(Request $request, Patient $patient)
    {
        $this->requireBillingView($request);

        $invoices = $patient->invoices()->with(['lines', 'payments'])->orderByDesc('issued_at')->get();

        return InvoiceResource::collection($invoices);
    }

    public function showInvoice(Request $request, Invoice $invoice)
    {
        $this->requireBillingView($request);

        $invoice->load([
            'lines.workItemToothStep.workItem.service',
            'lines.workItemToothStep.workItem.doctor',
            'lines.workItemToothStep.step',
            'payments',
            'patient',
        ]);

        // Which teeth this bill covers — the same set the lines carry, gathered
        // once so the invoice can draw its own chart wherever it's opened from
        // instead of depending on the screen that opened it to hand them over.
        $teeth = WorkItemToothStep::whereIn('invoice_line_id', $invoice->lines->pluck('id'))
            ->pluck('tooth_number')
            ->map(fn ($n) => (int) $n)
            ->unique()
            ->sort()
            ->values();

        return (new InvoiceResource($invoice))->additional([
            'meta' => [
                'teeth' => $teeth,
                // The chart is drawn differently for a child's mouth.
                'is_child' => (bool) $invoice->patient?->is_child,
                // Only the notes for the teeth on this bill: enough for the
                // per-tooth notebook shortcuts, without dragging the patient's
                // whole notebook along for a chart of two teeth.
                'tooth_notes' => $teeth->isEmpty() ? [] : Note::where('notable_type', (new Patient)->getMorphClass())
                    ->where('notable_id', $invoice->patient_id)
                    ->whereIn('tooth_number', $teeth)
                    ->get()
                    ->map(fn ($n) => [
                        'id' => $n->id,
                        'body' => $n->body,
                        'tooth_number' => (int) $n->tooth_number,
                        'created_at' => display_datetime($n->created_at),
                    ]),
                // Everything that moved this invoice's total after it was
                // issued — a general "خصم" on the bill, a step repriced, work
                // undone. Without these the invoice shows a total that doesn't
                // match its own lines and nothing on screen says why.
                'adjustments' => PatientTransaction::where('patient_id', $invoice->patient_id)
                    ->where('reference_id', $invoice->id)
                    ->whereIn('reference_type', ['invoice_discount', 'invoice_line_reprice', 'invoice_line_reversal'])
                    ->orderBy('occurred_at')
                    ->get()
                    ->map(fn ($t) => [
                        'id' => $t->id,
                        'kind' => $t->reference_type,
                        'label' => match ($t->reference_type) {
                            'invoice_discount' => 'خصم على الفاتورة',
                            'invoice_line_reprice' => 'تصحيح سعر',
                            default => 'إلغاء شغل محسوب',
                        },
                        'note' => $t->note,
                        'amount_ils' => round((float) $t->amount_ils, 2),
                        'occurred_at' => display_datetime($t->occurred_at),
                    ]),
                // Checks settle invoices too, so a bill paid by check would
                // otherwise look untouched next to its own "مدفوعة" badge.
                'checks' => CheckModel::where('direction', 'incoming')
                    ->where('party_type', 'patient')
                    ->where('party_id', $invoice->patient_id)
                    ->where('invoice_id', $invoice->id)
                    ->get()
                    ->map(fn ($c) => [
                        'id' => $c->id,
                        'check_number' => $c->check_number,
                        'bank_name' => $c->bank_name,
                        'amount_ils' => round((float) $c->amount, 2),
                        'status' => $c->status,
                        'due_date' => display_date($c->due_date),
                    ]),
            ],
        ]);
    }

    public function adjustInvoice(Request $request, Invoice $invoice, PaymentService $paymentService)
    {
        abort_unless($request->user()->can('billing.manage'), 403);

        $data = $request->validate([
            'total_amount_ils' => ['required', 'numeric', 'min:0'],
        ]);

        $invoice = $paymentService->adjustTotal($invoice, (float) $data['total_amount_ils']);

        return new InvoiceResource($invoice);
    }

    /**
     * Unified ILS ledger — running balance in display order (oldest first)
     * so "outstanding" is simply the final row's balance. Each row also gets
     * a human `description` ("خصم على فاتورة INV-000012", "فاتورة
     * INV-000012"...) so a discount/charge reads as "which session" at a
     * glance instead of just a bare amount.
     */
    public function ledger(Request $request, Patient $patient)
    {
        $this->requireBillingView($request);

        $transactions = $patient->transactions()->orderBy('occurred_at')->get();

        $invoiceIds = $transactions
            ->filter(fn ($t) => in_array($t->reference_type, ['invoice', 'invoice_discount', 'invoice_line_reprice', 'invoice_line_reversal'], true))
            ->pluck('reference_id')
            ->filter()
            ->unique();
        $invoiceNumbers = Invoice::withoutGlobalScopes()->whereIn('id', $invoiceIds)->pluck('invoice_number', 'id');

        // Check numbers, so a check settlement doesn't read as a bare "دفعة"
        // indistinguishable from cash on the very screen used to chase it up.
        $checkNumbers = CheckModel::whereIn(
            'id',
            $transactions->where('reference_type', 'check')->pluck('reference_id')->filter()->unique()
        )->pluck('check_number', 'id');

        $descriptionFor = function ($t) use ($invoiceNumbers, $checkNumbers) {
            $invoiceNumber = $invoiceNumbers->get($t->reference_id);
            $checkNumber = $t->reference_type === 'check' ? $checkNumbers->get($t->reference_id) : null;

            return match (true) {
                $t->reference_type === 'invoice' => $invoiceNumber ? "فاتورة {$invoiceNumber}" : 'فاتورة',
                $t->reference_type === 'invoice_discount' => $invoiceNumber ? "خصم على فاتورة {$invoiceNumber}" : 'خصم على فاتورة',
                $t->reference_type === 'invoice_line_reprice' => $invoiceNumber ? "تصحيح سعر — فاتورة {$invoiceNumber}" : 'تصحيح سعر',
                // Used to fall through to null, so undoing billed work showed
                // up as an unexplained "خصم" the clinic never actually gave.
                $t->reference_type === 'invoice_line_reversal' => $invoiceNumber ? "إلغاء شغل محسوب — فاتورة {$invoiceNumber}" : 'إلغاء شغل محسوب',
                $t->reference_type === 'patient_discount' => 'خصم عام على الحساب',
                $t->reference_type === 'check' && $t->type === 'charge' => $checkNumber ? "شيك مرتجع رقم {$checkNumber}" : 'شيك مرتجع',
                $t->reference_type === 'check' => $checkNumber ? "دفعة بشيك رقم {$checkNumber}" : 'دفعة بشيك',
                $t->type === 'payment' => 'دفعة نقدية',
                $t->type === 'refund' => 'استرجاع',
                default => null,
            };
        };

        $running = 0;
        $rows = $transactions->map(function ($t) use (&$running, $descriptionFor) {
            $signed = in_array($t->type, ['charge', 'adjustment'], true) ? $t->amount_ils : -$t->amount_ils;
            $running += $signed;

            return [
                'id' => $t->id,
                'type' => $t->type,
                'reference_type' => $t->reference_type,
                'reference_id' => $t->reference_id,
                'description' => $descriptionFor($t),
                'note' => $t->note,
                'amount' => $t->amount,
                'currency' => $t->currency,
                'amount_ils' => $t->amount_ils,
                // The amount as it actually moves the balance: charges and
                // adjustments carry their own sign, payments are stored
                // positive but reduce what's owed. Exposed so the UI shows the
                // same direction the running balance moves instead of
                // re-deriving the rule (and getting "--150.00" for discounts).
                'signed_amount_ils' => round($signed, 2),
                'balance_after_ils' => round($running, 2),
                'occurred_at' => display_datetime($t->occurred_at),
            ];
        });

        // The four headline figures, derived from the same rows the table
        // shows so a card can never disagree with what's listed under it.
        //
        // "Charged" is gross — what the work came to before anything was taken
        // off — because a card reading "الفواتير" next to a separate discounts
        // card has to be the number the discount comes off, or the three don't
        // add up on screen. Discounts are the negative adjustments (an invoice
        // discount, a general account discount, or work that was undone);
        // charges from a bounced check are not a bill for treatment, so they
        // stay out of the invoices figure and simply raise what's owed again.
        $charged = 0.0;
        $collected = 0.0;
        $discounted = 0.0;

        foreach ($transactions as $t) {
            $amount = (float) $t->amount_ils;

            if ($t->type === 'charge' && $t->reference_type !== 'check') {
                $charged += $amount;
            } elseif ($t->type === 'adjustment') {
                $amount < 0 ? $discounted += -$amount : $charged += $amount;
            } elseif (in_array($t->type, ['payment', 'refund'], true)) {
                // A refund is stored already-negative, so both sides just add:
                // subtracting it would hand the money back twice on screen.
                $collected += $amount;
            }
        }

        return [
            'outstanding_ils' => round($running, 2),
            'totals' => [
                'charged_ils' => round($charged, 2),
                'collected_ils' => round($collected, 2),
                'discounted_ils' => round($discounted, 2),
                'outstanding_ils' => round($running, 2),
            ],
            'transactions' => $rows->reverse()->values(),
        ];
    }

    /**
     * A discount on the whole account, not tied to any one invoice — for
     * "خصم عام" cases (loyalty, goodwill, family discount...) that should
     * just lower what the patient owes overall without touching any
     * invoice's own total (which stays the accurate record of what that
     * session actually cost).
     */
    public function addDiscount(Request $request, Patient $patient)
    {
        abort_unless($request->user()->can('billing.manage'), 403);

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $transaction = PatientTransaction::create([
            'patient_id' => $patient->id,
            'type' => 'adjustment',
            'reference_type' => 'patient_discount',
            'reference_id' => null,
            'note' => $data['note'] ?? null,
            'amount' => -$data['amount'],
            'currency' => 'ILS',
            'exchange_rate' => 1,
            'amount_ils' => -$data['amount'],
            'occurred_at' => now(),
        ]);

        return response()->json(['id' => $transaction->id], 201);
    }

    /**
     * "سجل الزيارات" — one row per billed invoice line, grouped by which
     * work item / step it came from so the UI can show which teeth and
     * which step of which service each charge belongs to.
     */
    public function visits(Request $request, Patient $patient)
    {
        $this->requireBillingView($request);

        $lines = InvoiceLine::with(['workItemToothStep.workItem.service', 'workItemToothStep.workItem.doctor', 'workItemToothStep.workItem.appointment', 'workItemToothStep.step', 'invoice'])
            ->whereHas('invoice', fn ($q) => $q->where('patient_id', $patient->id))
            ->orderByDesc('created_at')
            ->get();

        return $lines->map(function (InvoiceLine $line) {
            $toothStep = $line->workItemToothStep;
            $workItem = $toothStep?->workItem;
            $appointment = $workItem?->appointment;

            // A flat (non-per-tooth) charge's one invoice line can cover
            // several teeth — every tooth_step tagged with this same line
            // belongs to the same billed event.
            $siblingTeeth = $toothStep
                ? WorkItemToothStep::where('invoice_line_id', $line->id)->pluck('tooth_number')->map(fn ($n) => (int) $n)->values()->all()
                : [];

            return [
                'session_id' => $toothStep?->id,
                'item_id' => $workItem?->id,
                'plan_id' => $workItem?->id,
                'batch_id' => $line->id ? "line-{$line->id}" : null,
                // The real "one visit" grouping key — every charge billed
                // under work done at the same appointment groups together
                // here, regardless of how many separate services/invoice
                // lines it was split across. Falls back to batch_id (the
                // old per-invoice-line grouping) when a row has no linked
                // appointment at all (legacy data, or a work item that was
                // since rescheduled to a follow-up and lost this link).
                'appointment_id' => $appointment?->id,
                'appointment_date' => $appointment ? display_datetime($appointment->starts_at) : null,
                'created_at' => $line->created_at,
                'date' => display_datetime($line->created_at),
                'service_name' => $workItem?->service?->name,
                'step_title' => $toothStep?->step?->title,
                'tooth_number' => $toothStep ? (int) $toothStep->tooth_number : null,
                'tooth_numbers' => $siblingTeeth,
                'price' => $line->amount_ils,
                'note' => $line->description,
                'doctor_name' => $workItem?->doctor?->full_name,
                'is_quick_visit' => true,
                'invoice_id' => $line->invoice_id,
                'invoice_status' => $line->invoice?->status,
            ];
        })->values();
    }

    public function storePayment(StorePaymentRequest $request, Patient $patient, PaymentService $paymentService)
    {
        $cashbox = Cashbox::findOrFail($request->validated('cashbox_id'));
        $invoice = $request->filled('invoice_id') ? Invoice::findOrFail($request->validated('invoice_id')) : null;

        $payment = $paymentService->collect(
            patient: $patient,
            cashbox: $cashbox,
            amount: (float) $request->validated('amount'),
            currency: $request->validated('currency'),
            exchangeRate: (float) $request->validated('exchange_rate'),
            method: $request->validated('method'),
            invoice: $invoice,
        );

        return new PaymentResource($payment);
    }

    public function destroyPayment(Request $request, Payment $payment, PaymentService $paymentService)
    {
        abort_unless($request->user()->can('billing.manage'), 403);

        $paymentService->deletePayment($payment);

        return response()->noContent();
    }

    public function destroyInvoice(Request $request, Invoice $invoice, PaymentService $paymentService)
    {
        abort_unless($request->user()->can('billing.manage'), 403);

        $paymentService->deleteInvoice($invoice);

        return response()->noContent();
    }

    public function updateTransaction(Request $request, PatientTransaction $transaction, PaymentService $paymentService)
    {
        abort_unless($request->user()->can('billing.manage'), 403);

        $data = $request->validate(['amount' => ['required', 'numeric', 'min:0.01']]);

        $transaction = $paymentService->updateAdjustment($transaction, (float) $data['amount']);

        return response()->json($transaction);
    }

    public function destroyTransaction(Request $request, PatientTransaction $transaction, PaymentService $paymentService)
    {
        abort_unless($request->user()->can('billing.manage'), 403);

        $paymentService->deleteAdjustment($transaction);

        return response()->noContent();
    }

    public function updatePayment(Request $request, Payment $payment, PaymentService $paymentService)
    {
        abort_unless($request->user()->can('billing.manage'), 403);

        $data = $request->validate([
            'cashbox_id' => ['required', 'exists:cashboxes,id'],
            'amount' => ['required', 'numeric', 'min:0.01'],
            'exchange_rate' => ['required', 'numeric', 'min:0.000001'],
            'method' => ['required', Rule::in(['cash', 'card', 'transfer'])],
        ]);

        $cashbox = Cashbox::findOrFail($data['cashbox_id']);

        $payment = $paymentService->updatePayment(
            payment: $payment,
            cashbox: $cashbox,
            amount: (float) $data['amount'],
            exchangeRate: (float) $data['exchange_rate'],
            method: $data['method'],
        );

        return new PaymentResource($payment);
    }
}
