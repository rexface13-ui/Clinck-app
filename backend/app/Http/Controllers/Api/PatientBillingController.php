<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Billing\StorePaymentRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\PaymentResource;
use App\Models\Cashbox;
use App\Models\Invoice;
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
