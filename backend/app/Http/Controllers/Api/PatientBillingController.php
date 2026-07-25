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

    /**
     * Unified ILS ledger — running balance in display order (oldest first)
     * so "outstanding" is simply the final row's balance.
     */
    public function ledger(Request $request, Patient $patient)
    {
        $this->requireBillingView($request);

        $transactions = $patient->transactions()->orderBy('occurred_at')->get();

        $running = 0;
        $rows = $transactions->map(function ($t) use (&$running) {
            $signed = in_array($t->type, ['charge', 'adjustment'], true) ? $t->amount_ils : -$t->amount_ils;
            $running += $signed;

            return [
                'id' => $t->id,
                'type' => $t->type,
                'reference_type' => $t->reference_type,
                'reference_id' => $t->reference_id,
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
     * "سجل الزيارات" — one row per billed invoice line, grouped by which
     * work item / step it came from so the UI can show which teeth and
     * which step of which service each charge belongs to.
     */
    public function visits(Request $request, Patient $patient)
    {
        $this->requireBillingView($request);

        $lines = InvoiceLine::with(['workItemToothStep.workItem.service', 'workItemToothStep.workItem.doctor', 'workItemToothStep.step', 'invoice'])
            ->whereHas('invoice', fn ($q) => $q->where('patient_id', $patient->id))
            ->orderByDesc('created_at')
            ->get();

        return $lines->map(function (InvoiceLine $line) {
            $toothStep = $line->workItemToothStep;
            $workItem = $toothStep?->workItem;

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
}
