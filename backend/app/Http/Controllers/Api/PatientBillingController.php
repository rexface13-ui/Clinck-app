<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Billing\StorePaymentRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\PaymentResource;
use App\Models\Cashbox;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\WorkItemToothStep;
use App\Services\PaymentService;
use Illuminate\Http\Request;

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

        return new InvoiceResource($invoice->load(['lines', 'payments']));
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
            ->filter(fn ($t) => in_array($t->reference_type, ['invoice', 'invoice_discount', 'invoice_line_reprice'], true))
            ->pluck('reference_id')
            ->filter()
            ->unique();
        $invoiceNumbers = Invoice::withoutGlobalScopes()->whereIn('id', $invoiceIds)->pluck('invoice_number', 'id');

        $descriptionFor = function ($t) use ($invoiceNumbers) {
            $invoiceNumber = $invoiceNumbers->get($t->reference_id);

            return match (true) {
                $t->reference_type === 'invoice' => $invoiceNumber ? "فاتورة {$invoiceNumber}" : 'فاتورة',
                $t->reference_type === 'invoice_discount' => $invoiceNumber ? "خصم على فاتورة {$invoiceNumber}" : 'خصم على فاتورة',
                $t->reference_type === 'invoice_line_reprice' => $invoiceNumber ? "تصحيح سعر — فاتورة {$invoiceNumber}" : 'تصحيح سعر',
                $t->reference_type === 'patient_discount' => 'خصم عام على الحساب',
                $t->type === 'payment' => 'دفعة',
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
                'balance_after_ils' => round($running, 2),
                'occurred_at' => display_datetime($t->occurred_at),
            ];
        });

        return [
            'outstanding_ils' => round($running, 2),
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
}
