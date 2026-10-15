<?php

namespace Tests\Feature\Billing;

use App\Models\CashboxTransaction;
use App\Models\DoctorTransaction;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\PatientTransaction;
use App\Models\Payment;
use App\Models\ToothFinding;
use App\Models\WorkItemToothStep;
use App\Services\WorkItemService;
use App\Support\RecordDate;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * A payment forgotten on the day, or a session checked out a few days late,
 * has to be filed on the day it really happened — and moving it must never
 * change a single amount, double a total, or leave two reports disagreeing
 * about which day/month the same money belongs to.
 */
class BackdatedPaymentAndSessionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);
    }

    private function tz(): string
    {
        return config('dentaflow.display_timezone');
    }

    private function daysAgo(int $days): string
    {
        return Carbon::now($this->tz())->subDays($days)->format('Y-m-d');
    }

    /** A billed 1000 ₪ session, nothing paid yet. */
    private function billedSession(float $price = 1000): array
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor(commissionPercent: 20);
        $work = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), [11]));
        $result = app(WorkItemService::class)->checkout(patient: $patient, workItemIds: [$work->id], doctorId: $doctor->id);

        return [$patient, $doctor, Invoice::findOrFail($result['invoice_id'])];
    }

    private function pay($patient, float $amount, ?string $paidOn = null, ?int $invoiceId = null)
    {
        return $this->postJson("/api/patients/{$patient->id}/payments", array_filter([
            'invoice_id' => $invoiceId,
            'cashbox_id' => $this->cashbox->id,
            'amount' => $amount,
            'currency' => 'ILS',
            'exchange_rate' => 1,
            'method' => 'cash',
            'paid_on' => $paidOn,
        ], fn ($v) => $v !== null));
    }

    private function cashRowsFor(Payment $payment)
    {
        return CashboxTransaction::where('reference_id', $payment->id)->whereIn('reference_type', ['payment', 'payment_edited'])->get();
    }

    // --- entering a payment late ------------------------------------------

    public function test_a_payment_entered_late_carries_its_real_day_everywhere(): void
    {
        [$patient] = $this->billedSession(1000);
        $day = $this->daysAgo(5);

        $paymentId = $this->pay($patient, 400, $day)->assertOk()->json('data.id');
        $payment = Payment::findOrFail($paymentId);

        $this->assertSame($day, RecordDate::localIso($payment->paid_at));

        $cash = $this->cashRowsFor($payment);
        $this->assertCount(1, $cash);
        $this->assertSame($day, RecordDate::localIso($cash->first()->occurred_at), 'The cashbox movement must be on the same day.');

        $ledger = PatientTransaction::where('reference_type', 'payment')->where('reference_id', $payment->id)->firstOrFail();
        $this->assertSame($day, RecordDate::localIso($ledger->occurred_at), 'The patient statement line must be on the same day.');

        // Back-dating changes the day, never the money.
        $this->assertEquals(400, (float) $this->cashbox->fresh()->balance);
        $this->assertEquals(400, (float) $payment->amount);
    }

    public function test_a_payment_with_no_date_is_filed_now(): void
    {
        [$patient] = $this->billedSession(1000);

        $paymentId = $this->pay($patient, 100)->assertOk()->json('data.id');

        $this->assertSame($this->daysAgo(0), RecordDate::localIso(Payment::findOrFail($paymentId)->paid_at));
    }

    public function test_a_payment_cannot_be_dated_in_the_future(): void
    {
        [$patient] = $this->billedSession(1000);

        $this->pay($patient, 100, Carbon::now($this->tz())->addDays(2)->format('Y-m-d'))->assertStatus(422);

        $this->assertSame(0, Payment::count());
        $this->assertEquals(0, (float) $this->cashbox->fresh()->balance);
    }

    public function test_a_back_dated_payment_lands_in_the_right_day_of_every_report(): void
    {
        [$patient] = $this->billedSession(1000);
        $day = $this->daysAgo(10);
        $this->pay($patient, 250, $day)->assertOk();

        $onThatDay = $this->getJson("/api/reports/collections?from={$day}&to={$day}")->assertOk()->json('methods');
        $today = $this->getJson('/api/reports/collections?from='.$this->daysAgo(0).'&to='.$this->daysAgo(0))->assertOk()->json('methods');

        $this->assertEquals(250, collect($onThatDay)->firstWhere('method', 'cash')['total_ils']);
        $this->assertNull(collect($today)->firstWhere('method', 'cash'), 'Nothing was collected today — it must not leak onto today.');

        $flow = $this->getJson("/api/reports/money-flow?from={$day}&to={$day}")->assertOk()->json();
        $this->assertEquals(250, $flow['totals']['in_ils']);
    }

    public function test_a_back_dated_payment_settles_the_bill_exactly_like_a_current_one(): void
    {
        [$patient, , $invoice] = $this->billedSession(1000);

        $this->pay($patient, 1000, $this->daysAgo(7), $invoice->id)->assertOk();

        $this->assertSame('paid', $invoice->fresh()->status);
        $this->assertEquals(1000, (float) $invoice->fresh()->settled_amount_ils);
    }

    // --- editing a payment's date -----------------------------------------

    public function test_moving_a_payments_date_moves_all_of_it_and_adds_no_noise(): void
    {
        [$patient] = $this->billedSession(1000);
        $paymentId = $this->pay($patient, 300)->assertOk()->json('data.id');
        $payment = Payment::findOrFail($paymentId);
        $newDay = $this->daysAgo(4);

        $this->patchJson("/api/payments/{$payment->id}", [
            'cashbox_id' => $this->cashbox->id, 'amount' => 300, 'exchange_rate' => 1, 'method' => 'cash', 'paid_on' => $newDay,
        ])->assertOk();

        $payment->refresh();
        $this->assertSame($newDay, RecordDate::localIso($payment->paid_at));

        $cash = $this->cashRowsFor($payment);
        $this->assertCount(1, $cash, 'A date-only edit must not post a -old/+new pair that shows as money out and in.');
        $this->assertSame($newDay, RecordDate::localIso($cash->first()->occurred_at));

        $ledger = PatientTransaction::where('reference_type', 'payment')->where('reference_id', $payment->id)->get();
        $this->assertCount(1, $ledger);
        $this->assertSame($newDay, RecordDate::localIso($ledger->first()->occurred_at));

        $this->assertEquals(300, (float) $this->cashbox->fresh()->balance, 'Moving a date must not change the cashbox balance.');
        $this->assertEquals(300, (float) $payment->amount);
    }

    public function test_changing_amount_and_date_together_leaves_one_clean_total_on_the_new_day(): void
    {
        [$patient] = $this->billedSession(1000);
        $paymentId = $this->pay($patient, 100)->assertOk()->json('data.id');
        $payment = Payment::findOrFail($paymentId);
        $newDay = $this->daysAgo(6);

        $this->patchJson("/api/payments/{$payment->id}", [
            'cashbox_id' => $this->cashbox->id, 'amount' => 150, 'exchange_rate' => 1, 'method' => 'cash', 'paid_on' => $newDay,
        ])->assertOk();

        $rows = $this->cashRowsFor($payment);
        $this->assertEquals(150, round((float) $rows->sum('amount'), 2), 'Net cash for this payment is its current amount.');
        $this->assertTrue($rows->every(fn ($r) => RecordDate::localIso($r->occurred_at) === $newDay), 'Every movement sits on the new day.');
        $this->assertEquals(150, (float) $this->cashbox->fresh()->balance);

        $onDay = $this->getJson("/api/reports/money-flow?from={$newDay}&to={$newDay}")->assertOk()->json('cashboxes.0');
        $this->assertEquals(150, $onDay['movement']);
    }

    public function test_editing_only_the_amount_keeps_the_payments_original_day_in_the_statement(): void
    {
        [$patient] = $this->billedSession(1000);
        $day = $this->daysAgo(12);
        $paymentId = $this->pay($patient, 100, $day)->assertOk()->json('data.id');

        $this->patchJson("/api/payments/{$paymentId}", [
            'cashbox_id' => $this->cashbox->id, 'amount' => 120, 'exchange_rate' => 1, 'method' => 'cash',
        ])->assertOk();

        $payment = Payment::findOrFail($paymentId);
        $ledger = PatientTransaction::where('reference_type', 'payment')->where('reference_id', $paymentId)->firstOrFail();

        $this->assertSame($day, RecordDate::localIso($payment->paid_at));
        $this->assertSame($day, RecordDate::localIso($ledger->occurred_at), 'Editing an amount must not drag an old payment onto today.');
        $this->assertEquals(120, (float) $this->cashbox->fresh()->balance);
    }

    public function test_editing_only_the_method_posts_no_cashbox_movement(): void
    {
        [$patient] = $this->billedSession(1000);
        $paymentId = $this->pay($patient, 100)->assertOk()->json('data.id');
        $before = CashboxTransaction::count();

        $this->patchJson("/api/payments/{$paymentId}", [
            'cashbox_id' => $this->cashbox->id, 'amount' => 100, 'exchange_rate' => 1, 'method' => 'card',
        ])->assertOk();

        $this->assertSame($before, CashboxTransaction::count());
        $this->assertSame('card', Payment::findOrFail($paymentId)->method);
        $this->assertEquals(100, (float) $this->cashbox->fresh()->balance);
    }

    /**
     * The edit form used to open with the cashbox blank and the method reset
     * to "cash" — so correcting just a date meant re-picking the cashbox, and
     * saving without noticing turned a card payment into a cash one. The
     * statement now carries each payment's real cashbox and method.
     */
    public function test_the_statement_exposes_each_payments_real_cashbox_and_method(): void
    {
        [$patient] = $this->billedSession(1000);
        $paymentId = $this->postJson("/api/patients/{$patient->id}/payments", [
            'cashbox_id' => $this->cashbox->id, 'amount' => 200, 'currency' => 'ILS', 'exchange_rate' => 1, 'method' => 'card',
        ])->assertOk()->json('data.id');

        $rows = $this->getJson("/api/patients/{$patient->id}/ledger")->assertOk()->json('transactions');
        $row = collect($rows)->first(fn ($r) => $r['reference_type'] === 'payment' && $r['reference_id'] === $paymentId);

        $this->assertNotNull($row);
        $this->assertSame($this->cashbox->id, $row['payment_cashbox_id']);
        $this->assertSame('card', $row['payment_method']);
        $this->assertSame($this->daysAgo(0), $row['occurred_on']);
    }

    public function test_a_payment_date_cannot_be_edited_into_the_future(): void
    {
        [$patient] = $this->billedSession(1000);
        $paymentId = $this->pay($patient, 100)->assertOk()->json('data.id');

        $this->patchJson("/api/payments/{$paymentId}", [
            'cashbox_id' => $this->cashbox->id, 'amount' => 100, 'exchange_rate' => 1, 'method' => 'cash',
            'paid_on' => Carbon::now($this->tz())->addDay()->format('Y-m-d'),
        ])->assertStatus(422);
    }

    // --- moving a session's date ------------------------------------------

    public function test_moving_a_session_moves_every_date_it_lives_in_and_no_amount(): void
    {
        $this->travelTo(Carbon::create(2026, 10, 15, 14, 0, 0, $this->tz()));
        [$patient, $doctor, $invoice] = $this->billedSession(1000);

        $totalBefore = (float) $invoice->total_amount_ils;
        $commissionBefore = (float) DoctorTransaction::where('doctor_id', $doctor->id)->where('type', 'commission')->sum('amount_ils');

        $this->patchJson("/api/invoices/{$invoice->id}/date", ['issued_on' => '2026-09-20'])->assertOk();

        $invoice->refresh();
        $this->assertSame('2026-09-20', RecordDate::localIso($invoice->issued_at));
        $this->assertEquals($totalBefore, (float) $invoice->total_amount_ils, 'The bill itself must not change.');

        foreach (InvoiceLine::where('invoice_id', $invoice->id)->get() as $line) {
            $this->assertSame('2026-09-20', RecordDate::localIso($line->created_at));
        }

        $charge = PatientTransaction::where('reference_type', 'invoice')->where('reference_id', $invoice->id)->firstOrFail();
        $this->assertSame('2026-09-20', RecordDate::localIso($charge->occurred_at));

        $stepIds = WorkItemToothStep::whereIn('invoice_line_id', $invoice->lines()->pluck('id'))->pluck('id');
        foreach (ToothFinding::whereIn('work_item_tooth_step_id', $stepIds)->get() as $finding) {
            $this->assertSame('2026-09-20', RecordDate::localIso($finding->recorded_at));
        }

        $commission = DoctorTransaction::where('doctor_id', $doctor->id)->where('type', 'commission')->get();
        $this->assertEquals($commissionBefore, round((float) $commission->sum('amount_ils'), 2), 'Commission amount is untouched.');
        foreach ($commission as $c) {
            $this->assertSame('2026-09-01', $c->period_month->format('Y-m-d'), 'Commission follows the session into its month.');
        }
    }

    /** The reconciliation check is exactly what notices when two reports disagree about a month. */
    public function test_a_moved_session_keeps_every_revenue_report_in_agreement(): void
    {
        $this->travelTo(Carbon::create(2026, 10, 15, 14, 0, 0, $this->tz()));
        [, , $invoice] = $this->billedSession(1000);

        $this->patchJson("/api/invoices/{$invoice->id}/date", ['issued_on' => '2026-09-20'])->assertOk();

        $sept = $this->getJson('/api/reports/reconciliation?from=2026-09-01&to=2026-09-30')->assertOk()->json('revenue_check');
        $oct = $this->getJson('/api/reports/reconciliation?from=2026-10-01&to=2026-10-31')->assertOk()->json('revenue_check');

        $this->assertEquals(1000, $sept['ledger_ils']);
        $this->assertEquals(1000, $sept['invoices_ils']);
        $this->assertTrue($sept['ok']);

        $this->assertEquals(0, $oct['ledger_ils']);
        $this->assertEquals(0, $oct['invoices_ils']);
        $this->assertTrue($oct['ok']);

        $byService = $this->getJson('/api/reports/revenue-by-service?from=2026-09-01&to=2026-09-30')->assertOk()->json('services');
        $this->assertEquals(1000, round(array_sum(array_column($byService, 'total_ils')), 2));

        $pl = $this->getJson('/api/reports/profit-and-loss?from=2026-09-01&to=2026-09-30')->assertOk()->json();
        $this->assertEquals(1000, $pl['income']['revenue_ils']);
        $this->assertEquals(200, $pl['expenses']['commissions_ils'], 'The 20% commission follows the work into September.');
    }

    public function test_moving_a_session_does_not_touch_the_payments_made_against_it(): void
    {
        $this->travelTo(Carbon::create(2026, 10, 15, 14, 0, 0, $this->tz()));
        [$patient, , $invoice] = $this->billedSession(1000);
        $paymentId = $this->pay($patient, 400, null, $invoice->id)->assertOk()->json('data.id');
        $paidAtBefore = Payment::findOrFail($paymentId)->paid_at->copy();

        $this->patchJson("/api/invoices/{$invoice->id}/date", ['issued_on' => '2026-09-20'])->assertOk();

        $this->assertTrue(Payment::findOrFail($paymentId)->paid_at->equalTo($paidAtBefore));
        $this->assertEquals(400, (float) $invoice->fresh()->settled_amount_ils);
        $this->assertEquals(400, (float) $this->cashbox->fresh()->balance);
    }

    /**
     * The visit history prefers the appointment's own date over the billing
     * date. A session that was deliberately moved has to show the day it was
     * moved to there too, not keep reading the appointment's day while the
     * account and every report say another.
     */
    public function test_the_visit_history_shows_the_moved_date_not_the_appointment_date(): void
    {
        $this->travelTo(Carbon::create(2026, 10, 15, 14, 0, 0, $this->tz()));
        [$patient, $doctor, $invoice] = $this->billedSession(1000);

        $appointmentId = $this->postJson('/api/appointments', [
            'branch_id' => $this->branch->id,
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'starts_at' => '2026-10-15 10:00:00',
            'ends_at' => '2026-10-15 10:30:00',
        ])->assertCreated()->json('data.id');
        \App\Models\WorkItem::where('patient_id', $patient->id)->update(['appointment_id' => $appointmentId]);

        $before = collect($this->getJson("/api/patients/{$patient->id}/visits")->assertOk()->json());
        $this->assertNotNull($before->first()['appointment_date'], 'Unmoved: the appointment date is what shows.');

        $this->patchJson("/api/invoices/{$invoice->id}/date", ['issued_on' => '2026-10-09'])->assertOk();

        $after = collect($this->getJson("/api/patients/{$patient->id}/visits")->assertOk()->json());
        $this->assertNull($after->first()['appointment_date'], 'Moved: the appointment date must stop overriding the chosen day.');
        $this->assertStringStartsWith('09/10/2026', $after->first()['date']);
    }

    public function test_a_session_date_cannot_be_moved_into_the_future(): void
    {
        [, , $invoice] = $this->billedSession(1000);

        $this->patchJson("/api/invoices/{$invoice->id}/date", ['issued_on' => Carbon::now($this->tz())->addDays(3)->format('Y-m-d')])
            ->assertStatus(422);
    }

    public function test_sending_the_same_day_back_changes_nothing(): void
    {
        [, , $invoice] = $this->billedSession(1000);
        $issuedAt = $invoice->fresh()->issued_at->copy();

        $this->patchJson("/api/invoices/{$invoice->id}/date", ['issued_on' => RecordDate::localIso($issuedAt)])->assertOk();

        $this->assertTrue($invoice->fresh()->issued_at->equalTo($issuedAt), 'Re-saving the same day must not nudge its time.');
    }

    /** Commission already paid out for a month can't be silently re-pointed at another month. */
    public function test_a_session_cannot_leave_a_month_whose_commission_was_already_paid(): void
    {
        $this->travelTo(Carbon::create(2026, 10, 15, 14, 0, 0, $this->tz()));
        [, $doctor, $invoice] = $this->billedSession(1000);

        $this->postJson("/api/doctors/{$doctor->id}/commission-statement/pay", [
            'month' => '2026-10-01', 'amount' => 100, 'cashbox_id' => $this->cashbox->id, 'notes' => 'تصفية',
        ])->assertNoContent();

        $this->patchJson("/api/invoices/{$invoice->id}/date", ['issued_on' => '2026-09-20'])->assertStatus(422);

        $this->assertSame('2026-10-15', RecordDate::localIso($invoice->fresh()->issued_at), 'A refused move changes nothing.');
        $this->assertSame(
            '2026-10-01',
            DoctorTransaction::where('doctor_id', $doctor->id)->where('type', 'commission')->firstOrFail()->period_month->format('Y-m-d'),
        );
    }

    /** Within the same month there's no settlement to disturb, so it just moves. */
    public function test_a_session_can_move_within_its_month_even_after_commission_was_paid(): void
    {
        $this->travelTo(Carbon::create(2026, 10, 15, 14, 0, 0, $this->tz()));
        [, $doctor, $invoice] = $this->billedSession(1000);

        $this->postJson("/api/doctors/{$doctor->id}/commission-statement/pay", [
            'month' => '2026-10-01', 'amount' => 100, 'cashbox_id' => $this->cashbox->id, 'notes' => 'تصفية',
        ])->assertNoContent();

        $this->patchJson("/api/invoices/{$invoice->id}/date", ['issued_on' => '2026-10-03'])->assertOk();

        $this->assertSame('2026-10-03', RecordDate::localIso($invoice->fresh()->issued_at));
    }
}
