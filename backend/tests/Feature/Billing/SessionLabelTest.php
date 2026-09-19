<?php

namespace Tests\Feature\Billing;

use App\Models\Invoice;
use App\Models\Patient;
use App\Models\ServiceStep;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use App\Support\SessionLabel;
use Tests\TestCase;

/**
 * Nobody at the desk thinks in invoice numbers. A billed visit is called by
 * what was done and on which tooth: "جلسة: حشوة — سن 14".
 */
class SessionLabelTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);
    }

    private function bill(Patient $patient, array $workItems, $doctor): Invoice
    {
        $ids = array_map(fn ($w) => $w->id, $workItems);
        $result = app(WorkItemService::class)->checkout(patient: $patient, workItemIds: $ids, doctorId: $doctor->id);

        return Invoice::findOrFail($result['invoice_id']);
    }

    public function test_a_single_tooth_session_is_named_by_the_work_and_the_tooth(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $work = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('حشوة أسنان', 100), [14]));

        $this->assertSame('جلسة: حشوة أسنان — سن 14', SessionLabel::forInvoice($this->bill($patient, [$work], $doctor)));
    }

    public function test_several_teeth_are_listed_in_order(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $work = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('تنظيف', 70), [26, 14, 15]));

        $this->assertSame('جلسة: تنظيف — أسنان 14، 15، 26', SessionLabel::forInvoice($this->bill($patient, [$work], $doctor)));
    }

    public function test_more_than_one_piece_of_work_reads_as_the_first_plus_a_count(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $a = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('حشوة', 80), [14]));
        $b = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('تنظيف', 70), [11]));
        $c = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('خلع', 60), [48]));

        $label = SessionLabel::forInvoice($this->bill($patient, [$a, $b, $c], $doctor));

        $this->assertStringStartsWith('جلسة: ', $label);
        $this->assertStringEndsWith(' +2', $label);
    }

    public function test_a_multi_step_treatment_says_which_step_was_billed(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $service = $this->makeService('علاج عصب', 100);
        ServiceStep::create(['service_id' => $service->id, 'title' => 'حشو القناة', 'price' => 80, 'sort_order' => 2]);

        $work = app(WorkItemService::class)->create($patient, $doctor->id, $service, [16]);
        foreach ($work->toothSteps()->with('step')->get() as $ts) {
            if (($ts->step->sort_order ?? 1) === 1) {
                app(WorkItemService::class)->updateToothStep($ts, true, null);
            }
        }

        $label = SessionLabel::forInvoice($this->bill($patient, [$work->fresh()], $doctor));

        $this->assertSame('جلسة: علاج عصب (الخطوة الأولى) — سن 16', $label);
    }

    public function test_the_account_statement_names_sessions_not_invoice_numbers(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $work = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('حشوة أسنان', 100), [14]));
        $invoice = $this->bill($patient, [$work], $doctor);
        app(PaymentService::class)->adjustTotal($invoice, 80);

        $descriptions = collect($this->getJson("/api/patients/{$patient->id}/ledger")->assertOk()->json('transactions'))->pluck('description');

        $this->assertTrue($descriptions->contains('جلسة: حشوة أسنان — سن 14'));
        $this->assertTrue($descriptions->contains('خصم على جلسة: حشوة أسنان — سن 14'));
        $this->assertFalse($descriptions->contains(fn ($d) => str_contains((string) $d, 'INV-')), 'no invoice number should reach the screen');
    }

    public function test_the_patient_invoice_list_carries_the_label(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $work = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('حشوة أسنان', 100), [14]));
        $this->bill($patient, [$work], $doctor);

        $this->getJson("/api/patients/{$patient->id}/invoices")->assertOk()
            ->assertJsonPath('data.0.session_label', 'جلسة: حشوة أسنان — سن 14');
    }

    public function test_the_dashboard_and_the_daily_report_use_the_label_too(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $work = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService('حشوة أسنان', 100), [14]));
        $this->bill($patient, [$work], $doctor);

        $summary = $this->getJson('/api/dashboard/summary')->assertOk()->json('recent_invoices.0');
        $this->assertSame('جلسة: حشوة أسنان — سن 14', $summary['session_label']);

        $day = $this->getJson('/api/reports/daily-detail?date='.now()->toDateString())->assertOk()->json('invoices.0');
        $this->assertSame('جلسة: حشوة أسنان — سن 14', $day['session_label']);
    }
}
