<?php

namespace Tests\Feature\Reports;

use App\Models\ExpenseCategory;
use App\Models\Supplier;
use App\Services\CashboxService;
use App\Services\CheckService;
use App\Services\PaymentService;
use App\Services\SupplierService;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * One realistic clinic month, built once and checked against every money
 * report at the same time: cash, card, transfer and check income (one check
 * clean, one bounced), two expense categories posted the same way the real
 * UI posts them, a supplier payment, and a whole-account discount. Every
 * figure below was computed by hand from the scenario, not copied from
 * whatever the code happened to output — if a report's math ever drifts,
 * this is what should turn red first.
 */
class ComprehensiveMoneyAccuracyTest extends TestCase
{
    private function scenario(): array
    {
        $this->actingAs($this->owner);

        $doctor = $this->makeDoctor(commissionPercent: 20);

        // Patient A: حشوة 500، مدفوعة كاملة كاش، وبعدين خصم عام 50 ع الحساب
        // (خصم لا يلمس الفاتورة نفسها — يُحسب على الحساب بس).
        $patientA = $this->makePatient('مريضة أ');
        $workA = $this->completeWork($this->makeWorkItem($patientA, $doctor, $this->makeService('حشوة', 500), [11]));
        $resultA = app(WorkItemService::class)->checkout(patient: $patientA, workItemIds: [$workA->id], doctorId: $doctor->id, payCashboxId: $this->cashbox->id, payMethod: 'cash', payAmount: 500);
        $this->postJson("/api/patients/{$patientA->id}/discount", ['amount' => 50, 'note' => 'خصم زبون دائم'])->assertCreated();

        // Patient B: تنظيف 300، مدفوعة بطاقة.
        $patientB = $this->makePatient('مريض ب');
        $workB = $this->completeWork($this->makeWorkItem($patientB, $doctor, $this->makeService('تنظيف', 300), [21]));
        $resultB = app(WorkItemService::class)->checkout(patient: $patientB, workItemIds: [$workB->id], doctorId: $doctor->id);
        app(PaymentService::class)->collect(patient: $patientB, cashbox: $this->cashbox, amount: 300, currency: 'ILS', exchangeRate: 1, method: 'card', invoice: \App\Models\Invoice::find($resultB['invoice_id']));

        // Patient C: علاج عصب 800، نصف تحويل ونصف شيك — الاثنين يغطوا الفاتورة كاملة.
        $patientC = $this->makePatient('مريض ج');
        $workC = $this->completeWork($this->makeWorkItem($patientC, $doctor, $this->makeService('علاج عصب', 800), [31]));
        $resultC = app(WorkItemService::class)->checkout(patient: $patientC, workItemIds: [$workC->id], doctorId: $doctor->id);
        $invoiceC = \App\Models\Invoice::find($resultC['invoice_id']);
        app(PaymentService::class)->collect(patient: $patientC, cashbox: $this->cashbox, amount: 400, currency: 'ILS', exchangeRate: 1, method: 'transfer', invoice: $invoiceC);
        $checkC = app(CheckService::class)->receive(direction: 'incoming', partyType: 'patient', partyId: $patientC->id, checkNumber: 'C-1', bankName: 'بنك', amount: 400, currency: 'ILS', dueDate: now()->addMonth()->toDateString(), invoiceId: $invoiceC->id);

        // Patient D: خلع 200، شيك بس رجع (bounced) — الدين لازم يرجع.
        $patientD = $this->makePatient('مريض د');
        $workD = $this->completeWork($this->makeWorkItem($patientD, $doctor, $this->makeService('خلع', 200), [41]));
        $resultD = app(WorkItemService::class)->checkout(patient: $patientD, workItemIds: [$workD->id], doctorId: $doctor->id);
        $invoiceD = \App\Models\Invoice::find($resultD['invoice_id']);
        $checkD = app(CheckService::class)->receive(direction: 'incoming', partyType: 'patient', partyId: $patientD->id, checkNumber: 'D-1', bankName: 'بنك', amount: 200, currency: 'ILS', dueDate: now()->addMonth()->toDateString(), invoiceId: $invoiceD->id);
        app(CheckService::class)->bounce($checkD);

        // مصروفين حقيقيين مثل ما تسجلهم الواجهة (بيخصموا من الصندوق فعليًا).
        $category1 = ExpenseCategory::firstOrFail();
        $category2 = ExpenseCategory::skip(1)->firstOrFail();
        $this->postJson('/api/expenses', ['expense_category_id' => $category1->id, 'cashbox_id' => $this->cashbox->id, 'amount' => 1000, 'description' => 'إيجار'])->assertCreated();
        $this->postJson('/api/expenses', ['expense_category_id' => $category2->id, 'cashbox_id' => $this->cashbox->id, 'amount' => 150, 'description' => 'مستلزمات'])->assertCreated();

        // دفعة لمورد.
        $supplier = Supplier::create(['name' => 'مورد شامل', 'is_active' => true]);
        app(SupplierService::class)->pay($supplier, $this->cashbox, 300, 'ILS', 1.0, app(CashboxService::class));

        return compact('patientA', 'patientB', 'patientC', 'patientD');
    }

    /** Ledger revenue vs invoice revenue: the whole-account discount is ledger-only, the bounced check's re-charge must not inflate revenue either way — both paths still have to land on the same number. */
    public function test_reconciliation_matches_across_a_realistic_mixed_scenario(): void
    {
        $this->scenario();

        $check = $this->getJson('/api/reports/reconciliation')->assertOk()->json();

        // 500 + 300 + 800 + 200 - 50 discount = 1750 ledger; the bounce's
        // 200 re-charge is a 'check' reference and stays out of revenue.
        $this->assertEquals(1750.0, $check['revenue_check']['ledger_ils']);
        $this->assertEquals(50.0, $check['revenue_check']['account_discounts_ils']);
        $this->assertEquals(1800.0, $check['revenue_check']['invoices_ils']);
        $this->assertEquals(0.0, $check['revenue_check']['difference_ils']);
        $this->assertTrue($check['revenue_check']['ok']);

        // Cash 500 + card 300 + transfer 400 = 1200; the clean check (400)
        // counts, the bounced one (200) does not.
        $this->assertEquals(1200.0, $check['collected_ils']['cash_card_transfer']);
        $this->assertEquals(400.0, $check['collected_ils']['checks']);
        $this->assertEquals(1600.0, $check['collected_ils']['total']);
    }

    /** The revenue tab and the revenue-by-service tab have to describe the exact same 1800, split the exact same way. */
    public function test_revenue_by_service_matches_the_scenario_billed_exactly(): void
    {
        $this->scenario();

        $services = collect($this->getJson('/api/reports/revenue-by-service')->assertOk()->json('services'))->keyBy('service_name');

        $this->assertEquals(500.0, $services['حشوة']['total_ils']);
        $this->assertEquals(300.0, $services['تنظيف']['total_ils']);
        $this->assertEquals(800.0, $services['علاج عصب']['total_ils']);
        $this->assertEquals(200.0, $services['خلع']['total_ils']);
        $this->assertEquals(1800.0, round($services->sum('total_ils'), 2));
    }

    /** Collections has to name the same four methods and figures reconciliation() summarized. */
    public function test_collections_breaks_down_by_method_exactly(): void
    {
        $this->scenario();

        $methods = collect($this->getJson('/api/reports/collections')->assertOk()->json('methods'))->keyBy('method');

        $this->assertEquals(500.0, (float) $methods['cash']['total_ils']);
        $this->assertEquals(300.0, (float) $methods['card']['total_ils']);
        $this->assertEquals(400.0, (float) $methods['transfer']['total_ils']);
        $this->assertEquals(400.0, (float) $methods['check']['total_ils']);
    }

    /**
     * The P&L's every line, cross-checked: revenue from invoices (not the
     * ledger, so the account-level discount stays out of it, matching
     * revenue-by-service), commissions at the full billed price per doctor
     * (20% of 1800), two expense categories, one supplier payment, and a
     * net profit that is exactly revenue minus all three.
     */
    public function test_profit_and_loss_itemizes_the_full_scenario_and_adds_up(): void
    {
        $this->scenario();

        $pl = $this->getJson('/api/reports/profit-and-loss')->assertOk()->json();

        $this->assertEquals(1800.0, $pl['income']['revenue_ils']);
        $this->assertEquals(1800.0, round(array_sum(array_column($pl['income']['by_service'], 'total_ils')), 2));

        $this->assertEquals(360.0, $pl['expenses']['commissions_ils'], '20% of 1800 billed across all four sessions.');
        $this->assertEquals(1150.0, $pl['expenses']['operating_ils'], '1000 + 150 across the two categories.');
        $this->assertEquals(300.0, $pl['expenses']['supplier_payments_ils']);
        $this->assertEquals(1810.0, $pl['expenses']['total_ils']);

        $this->assertEquals(-10.0, $pl['net_profit_ils'], '1800 revenue minus 1810 in commissions + expenses + supplier payments.');

        // Same collected-money split reconciliation() reports.
        $this->assertEquals(1200.0, $pl['collected_ils']['cash_card_transfer']);
        $this->assertEquals(400.0, $pl['collected_ils']['checks']);
    }

    /**
     * Debts aging's headline number: only patient D actually owes money —
     * A ended up in credit (paid 500 against a 450 net bill), B and C are
     * settled exactly, and D's bounced check put their 200 back on the books.
     */
    public function test_debts_aging_total_owed_matches_only_the_bounced_patient(): void
    {
        ['patientD' => $patientD] = $this->scenario();

        $aging = $this->getJson('/api/reports/debts-aging')->assertOk()->json();

        $this->assertEquals(200.0, $aging['total_owed_ils']);
        $this->assertEquals(1, $aging['total_patients_owing']);

        $owing = collect($aging['buckets'])->flatMap(fn ($b) => $b['patients'])->keyBy('patient_id');
        $this->assertTrue($owing->has($patientD->id));
        $this->assertEquals(200.0, $owing[$patientD->id]['balance_ils']);
    }
}
