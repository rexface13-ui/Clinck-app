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
     * "سجل الزيارات" — one row per actually-completed session, billed or
     * not (billed via completeSession()). Grouped implicitly by the visit
     * itself (a session IS a visit here) rather than by invoice, since one
     * invoice can accumulate lines from sessions on different days.
     */
    public function visits(Request $request, Patient $patient)
    {
        $this->requireBillingView($request);

        // Sourced from the patient's invoice lines directly (not just lines
        // that carry a plan_item_session_id) — a handful of older charges
        // predate the per-session billing redesign and were never linked to
        // a session, and silently dropping those left real, debt-generating
        // charges invisible here even though they show up fine in the
        // ledger/outstanding balance. Every line that ever charged this
        // patient belongs in their visit history, session-linked or not.
        $lines = InvoiceLine::with(['planItemSession.planItem.service', 'planItemSession.planItem.treatmentPlan.doctor', 'invoice'])
            ->whereHas('invoice', fn ($q) => $q->where('patient_id', $patient->id))
            ->orderByDesc('created_at')
            ->get();

        return $lines->map(function (InvoiceLine $line) {
            $session = $line->planItemSession;
            $item = $session?->planItem;

            return [
                'session_id' => $session?->id,
                'item_id' => $item?->id,
                'plan_id' => $item?->treatment_plan_id,
                'batch_id' => $item?->batch_id,
                'created_at' => $line->created_at,
                'date' => display_datetime($line->created_at),
                'service_name' => $item?->service?->name,
                'tooth_number' => $item?->tooth_number,
                'tooth_numbers' => $item?->tooth_numbers,
                'price' => $line->amount_ils,
                'note' => $session?->note ?? $line->description,
                'doctor_name' => $item?->treatmentPlan?->doctor?->full_name,
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
