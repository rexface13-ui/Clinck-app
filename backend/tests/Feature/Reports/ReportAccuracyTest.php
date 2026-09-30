<?php

namespace Tests\Feature\Reports;

use App\Models\Invoice;
use App\Services\CheckService;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use Tests\TestCase;

/** What the owner reads off the reports page has to match the money. */
class ReportAccuracyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);
    }

    private function billWork(float $price = 1000): array
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), [11]));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        return [$patient, Invoice::findOrFail($result['invoice_id'])];
    }

    /**
     * The regression: revenue summed only 'charge' rows while discounts post
     * as separate negative 'adjustment' rows, so every discount ever given was
     * still reported as money earned.
     */
    public function test_revenue_is_reported_net_of_discounts(): void
    {
        [, $invoice] = $this->billWork(1000);
        app(PaymentService::class)->adjustTotal($invoice, 700);

        $response = $this->getJson('/api/reports/summary')->assertOk();

        // assertEquals, not assertSame: JSON gives back 700 (int) for a whole number.
        $this->assertEquals(700, $response->json('revenue_ils'), 'Revenue must drop by the discount given.');
    }

    public function test_net_profit_subtracts_commissions_and_discounts(): void
    {
        [, $invoice] = $this->billWork(1000);
        app(PaymentService::class)->adjustTotal($invoice, 700);

        $response = $this->getJson('/api/reports/summary')->assertOk();

        $expected = round($response->json('revenue_ils') - $response->json('commissions_ils') - $response->json('expenses_ils'), 2);
        $this->assertEquals($expected, $response->json('net_profit_ils'));
    }

    public function test_revenue_by_service_reflects_the_discount_not_the_list_price(): void
    {
        [, $invoice] = $this->billWork(1000);
        app(PaymentService::class)->adjustTotal($invoice, 700);

        $services = $this->getJson('/api/reports/revenue-by-service')->assertOk()->json('services');

        $this->assertSame(700.0, round(array_sum(array_column($services, 'total_ils')), 2), 'Per-service revenue must add up to what was actually charged.');
    }

    /**
     * Patient checks never touch the payments table, so a report reading only
     * payments silently lost every shekel collected by check.
     */
    public function test_collections_include_money_taken_by_check(): void
    {
        [$patient, $invoice] = $this->billWork(1000);

        app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '999',
            bankName: 'بنك',
            amount: 1000,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
            invoiceId: $invoice->id,
        );

        $methods = $this->getJson('/api/reports/collections')->assertOk()->json('methods');
        $byMethod = collect($methods)->keyBy('method');

        $this->assertTrue($byMethod->has('check'), 'Checks must show up as a collection method.');
        $this->assertSame(1000.0, (float) $byMethod['check']['total_ils']);
    }

    public function test_a_bounced_check_stops_counting_as_a_collection(): void
    {
        [$patient, $invoice] = $this->billWork(1000);

        $check = app(CheckService::class)->receive(
            direction: 'incoming',
            partyType: 'patient',
            partyId: $patient->id,
            checkNumber: '999',
            bankName: 'بنك',
            amount: 1000,
            currency: 'ILS',
            dueDate: now()->addMonth()->toDateString(),
            invoiceId: $invoice->id,
        );

        app(CheckService::class)->bounce($check);

        $methods = collect($this->getJson('/api/reports/collections')->assertOk()->json('methods'))->keyBy('method');

        $this->assertSame(0.0, (float) ($methods['check']['total_ils'] ?? 0));
    }

    /**
     * A returned check is booked as a 'charge' to put the debt back. It isn't
     * new work — the session was already billed — so revenue must not grow
     * every time a check bounces.
     */
    public function test_a_bounced_check_does_not_inflate_revenue(): void
    {
        [$patient, $invoice] = $this->billWork(1000);
        $before = $this->getJson('/api/reports/summary')->json('revenue_ils');

        $check = app(CheckService::class)->receive(
            direction: 'incoming', partyType: 'patient', partyId: $patient->id, checkNumber: '888', bankName: 'بنك',
            amount: 1000, currency: 'ILS', dueDate: now()->addMonth()->toDateString(), invoiceId: $invoice->id,
        );
        app(CheckService::class)->bounce($check);

        $this->assertEquals($before, $this->getJson('/api/reports/summary')->json('revenue_ils'));
        $monthly = collect($this->getJson('/api/reports/revenue?granularity=monthly&count=1')->json('periods'))->sum('total_ils');
        $this->assertEquals($before, $monthly, 'the monthly chart must agree with the summary');
    }

    /** Every revenue figure is net of discounts, so the per-service and per-doctor views must both add up to the invoice total. */
    public function test_doctor_productivity_revenue_is_net_of_discounts_like_the_service_report(): void
    {
        [, $invoice] = $this->billWork(1000);
        app(PaymentService::class)->adjustTotal($invoice, 700);

        $doctors = $this->getJson('/api/reports/doctor-productivity')->assertOk()->json('doctors');
        $services = $this->getJson('/api/reports/revenue-by-service')->assertOk()->json('services');

        $this->assertEquals(700.0, round(array_sum(array_column($doctors, 'revenue_ils')), 2));
        $this->assertEquals(round(array_sum(array_column($services, 'total_ils')), 2), round(array_sum(array_column($doctors, 'revenue_ils')), 2));
    }

    /**
     * The trust check itself: the ledger's own revenue figure and the
     * invoice lines' own revenue figure are two independent code paths, so a
     * normal billed-and-discounted session has to make both agree.
     */
    public function test_reconciliation_confirms_ledger_and_invoice_revenue_agree(): void
    {
        [, $invoice] = $this->billWork(1000);
        app(PaymentService::class)->adjustTotal($invoice, 700);

        $check = $this->getJson('/api/reports/reconciliation')->assertOk()->json('revenue_check');

        $this->assertEquals(700.0, $check['ledger_ils']);
        $this->assertEquals(700.0, $check['invoices_ils']);
        $this->assertEquals(0.0, $check['difference_ils']);
        $this->assertTrue($check['ok']);
    }

    /**
     * If a ledger adjustment is ever posted without a matching invoice
     * change (a data bug, not a normal flow), the reconciliation has to
     * actually notice — otherwise this check is decorative.
     */
    public function test_reconciliation_flags_a_real_mismatch(): void
    {
        [$patient, ] = $this->billWork(1000);

        // A ledger-only adjustment with nothing behind it on any invoice —
        // exactly the kind of drift the reconciliation exists to catch.
        \App\Models\PatientTransaction::create([
            'patient_id' => $patient->id,
            'type' => 'adjustment',
            'reference_type' => 'patient_discount',
            'amount' => -50,
            'currency' => 'ILS',
            'exchange_rate' => 1,
            'amount_ils' => -50,
            'occurred_at' => now(),
        ]);

        $check = $this->getJson('/api/reports/reconciliation')->assertOk()->json('revenue_check');

        $this->assertEquals(950.0, $check['ledger_ils']);
        $this->assertEquals(1000.0, $check['invoices_ils']);
        $this->assertEquals(-50.0, $check['difference_ils']);
        $this->assertFalse($check['ok']);
    }

    /**
     * The collected-money side of the same check: cash/card/transfer and
     * checks both have to show up, and separately from each other so a
     * "how much actually came in" read never hides one behind the other.
     */
    public function test_reconciliation_totals_cash_and_checks_collected(): void
    {
        [$patient, $invoice] = $this->billWork(1000);
        app(PaymentService::class)->collect(patient: $patient, invoice: $invoice, cashbox: $this->cashbox, amount: 400, currency: 'ILS', exchangeRate: 1, method: 'cash');

        app(CheckService::class)->receive(
            direction: 'incoming', partyType: 'patient', partyId: $patient->id, checkNumber: '777', bankName: 'بنك',
            amount: 600, currency: 'ILS', dueDate: now()->addMonth()->toDateString(), invoiceId: $invoice->id,
        );

        $collected = $this->getJson('/api/reports/reconciliation')->assertOk()->json('collected_ils');

        $this->assertEquals(400.0, $collected['cash_card_transfer']);
        $this->assertEquals(600.0, $collected['checks']);
        $this->assertEquals(1000.0, $collected['total']);
    }

    /**
     * This endpoint crashed in production with "column reference created_at is
     * ambiguous" — a Postgres-only error, which is exactly why the suite runs
     * on Postgres rather than sqlite.
     */
    public function test_every_report_endpoint_answers_at_each_granularity(): void
    {
        $this->billWork(1000);

        foreach (['daily', 'weekly', 'monthly'] as $granularity) {
            $this->getJson("/api/reports/revenue?granularity={$granularity}")->assertOk();
            $this->getJson("/api/reports/sessions-by-period?granularity={$granularity}")->assertOk();
        }

        foreach ([
            'summary', 'revenue-by-service', 'doctor-productivity', 'patients',
            'no-show', 'debts-aging', 'collections', 'pending-treatments',
            'cashbox-flow', 'suppliers-checks', 'reconciliation',
        ] as $endpoint) {
            $this->getJson("/api/reports/{$endpoint}")->assertOk();
        }

        $this->getJson('/api/reports/daily-detail?date='.now()->toDateString())->assertOk();
        $this->getJson('/api/reports/weekly-detail?date='.now()->toDateString())->assertOk();
    }

    public function test_the_daily_report_lists_the_invoices_raised_that_day(): void
    {
        [, $invoice] = $this->billWork(1000);

        $day = $this->getJson('/api/reports/daily-detail?date='.now()->toDateString())->assertOk();

        $this->assertEquals(1000, $day->json('revenue_ils'));
        $this->assertSame($invoice->invoice_number, $day->json('invoices.0.invoice_number'));
    }

    public function test_the_weekly_report_runs_saturday_to_friday(): void
    {
        $week = $this->getJson('/api/reports/weekly-detail?date='.now()->toDateString())->assertOk();

        $this->assertCount(7, $week->json('days'));
        $this->assertSame('Saturday', date('l', strtotime($week->json('week_start'))));
        $this->assertSame('Friday', date('l', strtotime($week->json('week_end'))));
    }
}
