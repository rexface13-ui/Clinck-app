<?php

namespace Tests\Feature\Billing;

use App\Models\ActivityLog;
use App\Models\Cashbox;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Services\PaymentService;
use App\Services\WorkItemService;
use Tests\TestCase;

/**
 * Deleting a patient used to mean either "blocked" (any history) or a
 * permanent wipe of everything. Archiving replaces both: nothing is erased,
 * the patient leaves the everyday lists, and any money the clinic is holding
 * (or is owed) has to be resolved out loud — kept, refunded, written off or
 * left as debt — and shows up in the activity log.
 */
class PatientArchiveTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);
        $this->cashbox->update(['balance' => 0]);
    }

    private function billed(Patient $patient, float $price): Invoice
    {
        $doctor = $this->makeDoctor();
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $this->makeService(price: $price), [11]));
        $result = app(WorkItemService::class)->checkout(patient: $patient, workItemIds: [$workItem->id], doctorId: $doctor->id);

        return Invoice::findOrFail($result['invoice_id']);
    }

    private function pay(Patient $patient, float $amount): void
    {
        app(PaymentService::class)->collect($patient, $this->cashbox, $amount, 'ILS', 1.0, 'cash');
    }

    public function test_a_settled_patient_is_archived_without_any_question_about_money(): void
    {
        $patient = $this->makePatient();
        $this->billed($patient, 100);
        $this->pay($patient, 100);

        $this->postJson("/api/patients/{$patient->id}/archive")->assertOk()->assertJsonPath('data.is_archived', true);

        $this->assertNotNull($patient->fresh()->archived_at);
    }

    public function test_archiving_keeps_every_record_it_never_deletes_history(): void
    {
        $patient = $this->makePatient();
        $this->billed($patient, 100);
        $this->pay($patient, 100);
        $transactions = PatientTransaction::where('patient_id', $patient->id)->count();

        $this->postJson("/api/patients/{$patient->id}/archive")->assertOk();

        $this->assertSame($transactions, PatientTransaction::where('patient_id', $patient->id)->count());
        $this->assertSame(1, Invoice::where('patient_id', $patient->id)->count());
        $this->assertNotNull(Patient::find($patient->id));
    }

    public function test_a_patient_the_clinic_holds_money_for_must_choose_what_happens_to_it(): void
    {
        $patient = $this->makePatient();
        $this->pay($patient, 300);

        $this->postJson("/api/patients/{$patient->id}/archive")->assertStatus(422);
        $this->assertNull($patient->fresh()->archived_at);
    }

    public function test_the_preview_reports_the_credit_so_the_dialog_can_warn(): void
    {
        $patient = $this->makePatient();
        $this->pay($patient, 300);

        $this->getJson("/api/patients/{$patient->id}/archive-preview")
            ->assertOk()
            ->assertJsonPath('credit_ils', 300)
            ->assertJsonPath('debt_ils', 0)
            ->assertJsonPath('total_paid_ils', 300);
    }

    public function test_keeping_the_money_books_it_as_clinic_income_and_zeroes_the_account(): void
    {
        $patient = $this->makePatient();
        $this->pay($patient, 300);

        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'keep'])->assertOk();

        $this->assertSame(0.0, $patient->fresh()->ledgerBalance());
        $retained = PatientTransaction::where('patient_id', $patient->id)->where('reference_type', 'archive_retained_credit')->firstOrFail();
        $this->assertEquals(300.0, (float) $retained->amount_ils);
        $this->assertEquals(300.0, (float) $this->cashbox->fresh()->balance, 'the cash stays in the cashbox');
    }

    public function test_refunding_hands_the_money_back_out_of_the_chosen_cashbox(): void
    {
        $patient = $this->makePatient();
        $this->pay($patient, 300);

        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'refund', 'cashbox_id' => $this->cashbox->id])->assertOk();

        $this->assertSame(0.0, $patient->fresh()->ledgerBalance());
        $this->assertEquals(0.0, (float) $this->cashbox->fresh()->balance);
    }

    public function test_a_refund_needs_a_cashbox_that_can_actually_cover_it(): void
    {
        $patient = $this->makePatient();
        $this->pay($patient, 300);
        $this->cashbox->update(['balance' => 50]);

        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'refund', 'cashbox_id' => $this->cashbox->id])->assertStatus(422);
        $this->assertNull($patient->fresh()->archived_at);
        $this->assertEquals(50.0, (float) $this->cashbox->fresh()->balance);
    }

    public function test_a_refund_without_naming_a_cashbox_is_refused(): void
    {
        $patient = $this->makePatient();
        $this->pay($patient, 300);

        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'refund'])->assertStatus(422);
    }

    public function test_a_patient_who_owes_must_choose_between_leaving_the_debt_and_writing_it_off(): void
    {
        $patient = $this->makePatient();
        $this->billed($patient, 200);

        $this->postJson("/api/patients/{$patient->id}/archive")->assertStatus(422);
        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'refund', 'cashbox_id' => $this->cashbox->id])->assertStatus(422);
    }

    public function test_leaving_the_debt_keeps_it_on_the_books(): void
    {
        $patient = $this->makePatient();
        $this->billed($patient, 200);

        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'keep_debt'])->assertOk();

        $this->assertSame(200.0, $patient->fresh()->ledgerBalance());
    }

    public function test_writing_the_debt_off_clears_the_balance_and_says_so_in_the_ledger(): void
    {
        $patient = $this->makePatient();
        $this->billed($patient, 200);

        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'write_off'])->assertOk();

        $this->assertSame(0.0, $patient->fresh()->ledgerBalance());
        $this->assertTrue(PatientTransaction::where('patient_id', $patient->id)->where('reference_type', 'archive_write_off')->exists());
    }

    public function test_archived_patients_leave_the_lists_but_show_in_the_archive_view(): void
    {
        $active = $this->makePatient('نشط');
        $gone = $this->makePatient('مؤرشف');
        $this->postJson("/api/patients/{$gone->id}/archive")->assertOk();

        $names = collect($this->getJson('/api/patients')->json('data'))->pluck('full_name');
        $this->assertTrue($names->contains('نشط'));
        $this->assertFalse($names->contains('مؤرشف'));

        $searchNames = collect($this->getJson('/api/patients?search=مؤرشف')->json('data'))->pluck('full_name');
        $this->assertFalse($searchNames->contains('مؤرشف'), 'search must not surface archived files either');

        $archived = collect($this->getJson('/api/patients?archived=1')->json('data'))->pluck('full_name');
        $this->assertTrue($archived->contains('مؤرشف'));
        $this->assertFalse($archived->contains('نشط'));
    }

    public function test_an_archived_file_can_still_be_opened_and_restored(): void
    {
        $patient = $this->makePatient();
        $this->postJson("/api/patients/{$patient->id}/archive")->assertOk();

        $this->getJson("/api/patients/{$patient->id}")->assertOk()->assertJsonPath('data.is_archived', true);

        $this->postJson("/api/patients/{$patient->id}/restore")->assertOk()->assertJsonPath('data.is_archived', false);
        $this->assertNull($patient->fresh()->archived_at);
    }

    public function test_no_appointment_can_be_booked_for_an_archived_patient(): void
    {
        $patient = $this->makePatient();
        $this->postJson("/api/patients/{$patient->id}/archive")->assertOk();

        $this->postJson('/api/appointments', [
            'branch_id' => $this->branch->id,
            'patient_id' => $patient->id,
            'starts_at' => now()->addDay()->toIso8601String(),
            'ends_at' => now()->addDay()->addMinutes(30)->toIso8601String(),
        ])->assertStatus(422);
    }

    public function test_archiving_and_the_money_decision_land_in_the_activity_log(): void
    {
        $patient = $this->makePatient('سعيد');
        $this->pay($patient, 300);

        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'refund', 'cashbox_id' => $this->cashbox->id, 'note' => 'سافر'])->assertOk();

        $log = ActivityLog::where('action', 'patient.archived')->firstOrFail();
        $this->assertStringContainsString('سعيد', $log->description);
        $this->assertStringContainsString('300', $log->description);
        $this->assertStringContainsString('سافر', $log->description);

        $this->postJson("/api/patients/{$patient->id}/restore")->assertOk();
        $this->assertTrue(ActivityLog::where('action', 'patient.restored')->exists());
    }

    public function test_the_ledger_explains_the_archive_entries_in_words(): void
    {
        $patient = $this->makePatient();
        $this->pay($patient, 300);
        $this->postJson("/api/patients/{$patient->id}/archive", ['resolution' => 'keep'])->assertOk();

        $descriptions = collect($this->getJson("/api/patients/{$patient->id}/ledger")->json('transactions'))->pluck('description');
        $this->assertTrue($descriptions->contains(fn ($d) => str_contains((string) $d, 'احتفظت فيه العيادة عند أرشفة')));
    }

    public function test_an_already_archived_file_cannot_be_archived_twice(): void
    {
        $patient = $this->makePatient();
        $this->postJson("/api/patients/{$patient->id}/archive")->assertOk();

        $this->postJson("/api/patients/{$patient->id}/archive")->assertStatus(422);
    }
}
