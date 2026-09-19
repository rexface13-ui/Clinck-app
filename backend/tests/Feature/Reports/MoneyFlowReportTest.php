<?php

namespace Tests\Feature\Reports;

use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Invoice;
use App\Models\Supplier;
use App\Services\CashboxService;
use App\Services\CheckService;
use App\Services\PaymentService;
use App\Services\SupplierService;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * "الداخل والخارج": whenever money comes in or leaves — cash, card, transfer
 * or check; a payment, a refund, an expense, a salary, a supplier — it has
 * to be counted, once, under the right heading.
 */
class MoneyFlowReportTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);
        $this->cashbox->update(['balance' => 0]);
    }

    private function flow(string $query = ''): array
    {
        return $this->getJson('/api/reports/money-flow'.$query)->assertOk()->json();
    }

    private function billedPatient(float $price = 1000): array
    {
        $patient = $this->makePatient('مريض الداخل');
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), [11]));
        $result = app(WorkItemService::class)->checkout(patient: $patient, workItemIds: [$workItem->id], doctorId: $doctor->id);

        return [$patient, Invoice::findOrFail($result['invoice_id']), $doctor];
    }

    private function receiveCheck($patient, Invoice $invoice, float $amount = 400, string $number = 'C-1')
    {
        return app(CheckService::class)->receive(
            direction: 'incoming', partyType: 'patient', partyId: $patient->id, checkNumber: $number, bankName: 'بنك',
            amount: $amount, currency: 'ILS', dueDate: now()->addWeek()->toDateString(), invoiceId: $invoice->id,
        );
    }

    public function test_cash_card_and_transfer_payments_are_counted_in_by_method(): void
    {
        [$patient, $invoice] = $this->billedPatient(1000);
        $pay = app(PaymentService::class);
        $pay->collect($patient, $this->cashbox, 300, 'ILS', 1.0, 'cash', $invoice);
        $pay->collect($patient, $this->cashbox, 200, 'ILS', 1.0, 'card', $invoice);
        $pay->collect($patient, $this->cashbox, 100, 'ILS', 1.0, 'transfer', $invoice);

        $t = $this->flow()['totals'];

        $this->assertEquals(600, $t['in_ils']);
        $this->assertEquals(300, $t['in_by_method']['cash']);
        $this->assertEquals(200, $t['in_by_method']['card']);
        $this->assertEquals(100, $t['in_by_method']['transfer']);
        $this->assertEquals(0, $t['out_ils']);
    }

    public function test_a_refund_to_a_patient_counts_as_money_out(): void
    {
        [$patient] = $this->billedPatient(1000);
        $pay = app(PaymentService::class);
        $pay->collect($patient, $this->cashbox, 500, 'ILS', 1.0, 'cash');
        $pay->refund($patient, $this->cashbox, 120, 'ILS', 1.0, 'cash');

        $t = $this->flow()['totals'];

        $this->assertEquals(500, $t['in_ils']);
        $this->assertEquals(120, $t['out_ils']);
        $this->assertEquals(380, $t['net_ils']);
    }

    public function test_expenses_salaries_and_supplier_payments_all_count_as_money_out(): void
    {
        $this->cashbox->update(['balance' => 5000]);

        $category = ExpenseCategory::firstOrFail();
        $expense = Expense::create(['expense_category_id' => $category->id, 'cashbox_id' => $this->cashbox->id, 'amount' => 200, 'currency' => 'ILS', 'amount_ils' => 200, 'spent_at' => now()]);
        app(CashboxService::class)->record($this->cashbox, 'expense_out', 'expense', $expense->id, -200);

        $doctor = $this->makeDoctor();
        $this->postJson("/api/doctors/{$doctor->id}/commission-statement/pay", [
            'month' => now()->startOfMonth()->toDateString(), 'amount' => 700, 'cashbox_id' => $this->cashbox->id, 'notes' => 'راتب',
        ])->assertNoContent();

        $supplier = Supplier::create(['name' => 'مورد الاختبار', 'is_active' => true]);
        app(SupplierService::class)->pay($supplier, $this->cashbox, 350, 'ILS', 1.0, app(CashboxService::class));

        $flow = $this->flow();

        $this->assertEquals(1250, $flow['totals']['out_ils'], 'expense 200 + salary 700 + supplier 350');
        $categories = collect($flow['by_category'])->where('direction', 'out')->pluck('total_ils', 'category');
        $this->assertEquals(700, $categories['رواتب وعمولات الأطباء']);
        $this->assertEquals(350, $categories['دفعة لمورد']);
        $this->assertEquals(200, $categories[$category->name]);
        $this->assertContains('مورد الاختبار', collect($flow['rows'])->pluck('party')->all());
    }

    public function test_a_check_counts_when_it_is_received_not_only_when_it_clears(): void
    {
        [$patient, $invoice] = $this->billedPatient(1000);
        $this->receiveCheck($patient, $invoice, 400);

        $flow = $this->flow();

        $this->assertEquals(400, $flow['totals']['in_by_method']['check'], 'a received check is money in immediately');
        $this->assertEquals(400, $flow['pending_checks']['incoming_ils']);
    }

    public function test_a_check_that_clears_into_the_cashbox_is_not_counted_twice(): void
    {
        [$patient, $invoice] = $this->billedPatient(1000);
        $check = $this->receiveCheck($patient, $invoice, 400);
        app(CheckService::class)->clear($check, $this->cashbox, app(CashboxService::class));

        $flow = $this->flow();

        $this->assertEquals(400, $flow['totals']['in_ils']);
        $this->assertEquals(0, $flow['pending_checks']['incoming_ils'], 'no longer pending once it cleared');
        $this->assertEquals(400, $flow['cashboxes'][0]['movement'], 'the cashbox itself still moved once');
    }

    public function test_a_bounced_check_is_listed_but_not_counted(): void
    {
        [$patient, $invoice] = $this->billedPatient(1000);
        $check = $this->receiveCheck($patient, $invoice, 400);
        app(CheckService::class)->bounce($check);

        $flow = $this->flow();

        $this->assertEquals(0, $flow['totals']['in_ils']);
        $row = collect($flow['rows'])->firstWhere('source', 'check');
        $this->assertSame('bounced', $row['status']);
        $this->assertFalse($row['counted']);
    }

    public function test_a_check_issued_to_a_supplier_counts_as_money_out(): void
    {
        $supplier = Supplier::create(['name' => 'مورد الشيكات', 'is_active' => true]);
        app(CheckService::class)->receive(
            direction: 'outgoing', partyType: 'supplier', partyId: $supplier->id, checkNumber: 'OUT-1', bankName: 'بنك',
            amount: 900, currency: 'ILS', dueDate: now()->addMonth()->toDateString(),
        );

        $flow = $this->flow();

        $this->assertEquals(900, $flow['totals']['out_by_method']['check']);
        $this->assertEquals(900, $flow['pending_checks']['outgoing_ils']);
    }

    public function test_cashbox_opening_movement_and_closing_reconcile_with_the_live_balance(): void
    {
        [$patient] = $this->billedPatient(1000);
        app(PaymentService::class)->collect($patient, $this->cashbox, 800, 'ILS', 1.0, 'cash');
        app(PaymentService::class)->refund($patient, $this->cashbox, 100, 'ILS', 1.0, 'cash');

        $box = collect($this->flow()['cashboxes'])->firstWhere('id', $this->cashbox->id);

        $this->assertEquals(0, $box['opening']);
        $this->assertEquals(700, $box['movement']);
        $this->assertEquals($box['closing'], $box['current_balance']);
    }

    public function test_an_expense_that_never_reached_the_cashbox_is_flagged_instead_of_silently_missing(): void
    {
        $category = ExpenseCategory::firstOrFail();
        Expense::create(['expense_category_id' => $category->id, 'cashbox_id' => $this->cashbox->id, 'amount' => 545, 'currency' => 'ILS', 'amount_ils' => 545, 'spent_at' => now()]);

        $flow = $this->flow();

        $this->assertSame(0.0, (float) $flow['totals']['out_ils']);
        $this->assertCount(1, $flow['warnings']);
        $this->assertEquals(545, $flow['warnings'][0]['total_ils']);
    }

    public function test_a_properly_posted_expense_raises_no_warning(): void
    {
        $category = ExpenseCategory::firstOrFail();
        $expense = Expense::create(['expense_category_id' => $category->id, 'cashbox_id' => $this->cashbox->id, 'amount' => 80, 'currency' => 'ILS', 'amount_ils' => 80, 'spent_at' => now()]);
        app(CashboxService::class)->record($this->cashbox, 'expense_out', 'expense', $expense->id, -80);

        $flow = $this->flow();

        $this->assertSame([], $flow['warnings']);
        $this->assertEquals(80, $flow['totals']['out_ils']);
    }

    public function test_the_date_range_only_includes_movements_inside_it(): void
    {
        [$patient] = $this->billedPatient(1000);
        $pay = app(PaymentService::class);

        $this->travelTo(now()->subDays(10));
        $pay->collect($patient, $this->cashbox, 111, 'ILS', 1.0, 'cash');
        $this->travelBack();
        $pay->collect($patient, $this->cashbox, 222, 'ILS', 1.0, 'cash');

        $today = now()->toDateString();
        $recent = $this->flow("?from={$today}&to={$today}");
        $all = $this->flow();

        $this->assertEquals(222, $recent['totals']['in_ils']);
        $this->assertEquals(333, $all['totals']['in_ils']);
        $this->assertEquals(111, collect($this->flow("?from={$today}&to={$today}")['cashboxes'])->firstWhere('id', $this->cashbox->id)['opening'], 'money in before the range is the opening balance');
    }
}
