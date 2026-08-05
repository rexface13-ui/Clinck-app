<?php

namespace Tests\Feature\Clinical;

use App\Models\Invoice;
use App\Models\WorkItemToothStep;
use App\Services\WorkItemService;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Covers the repair migration for the damage the "apply to all teeth" shortcut
 * used to do: a tooth-step left billed while reading as not done.
 */
class StrandedChargeRepairTest extends TestCase
{
    private function runRepair(): void
    {
        (require base_path('database/migrations/2026_08_05_110000_settle_tooth_steps_billed_but_reading_not_done.php'))->up();
    }

    private function billedSession(bool $pricePerTooth = true): array
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $service = $this->makeService(price: 100, pricePerTooth: $pricePerTooth);
        $workItem = $this->completeWork($this->makeWorkItem($patient, $doctor, $service, [11, 21]));

        $result = app(WorkItemService::class)->checkout(
            patient: $patient,
            workItemIds: [$workItem->id],
            doctorId: $doctor->id,
        );

        return [$workItem->fresh(), Invoice::findOrFail($result['invoice_id'])];
    }

    /** Exactly what the bug left behind: the tick gone, the charge still there. */
    private function strand(WorkItemToothStep $toothStep): void
    {
        DB::table('work_item_tooth_steps')->where('id', $toothStep->id)->update(['completed_at' => null]);
    }

    public function test_per_tooth_work_gets_its_charge_reversed(): void
    {
        [$workItem, $invoice] = $this->billedSession(pricePerTooth: true);

        $this->assertEquals(200, $invoice->total_amount_ils);

        $stranded = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 21)->firstOrFail();
        $this->strand($stranded);

        $this->runRepair();

        $stranded = $stranded->fresh();
        $this->assertNull($stranded->completed_at);
        $this->assertNull($stranded->invoice_line_id, 'The charge should have come off with the tick.');
        $this->assertEquals(100, $invoice->fresh()->total_amount_ils, 'The patient should no longer be billed for it.');
    }

    /** A flat fee can't be split per tooth, so the tick goes back instead. */
    public function test_flat_fee_work_gets_its_tick_restored(): void
    {
        [$workItem, $invoice] = $this->billedSession(pricePerTooth: false);

        $before = (float) $invoice->total_amount_ils;

        $stranded = WorkItemToothStep::where('work_item_id', $workItem->id)->where('tooth_number', 21)->firstOrFail();
        $this->strand($stranded);

        $this->runRepair();

        $stranded = $stranded->fresh();
        $this->assertNotNull($stranded->completed_at, 'A flat-fee tooth must read as done, since it stays billed.');
        $this->assertNotNull($stranded->invoice_line_id);
        $this->assertEquals($before, (float) $invoice->fresh()->total_amount_ils, 'Nothing about the money should move.');
    }

    /** Nothing to repair must stay a no-op — including on a second run. */
    public function test_healthy_data_is_left_alone_and_the_repair_can_run_twice(): void
    {
        [$workItem, $invoice] = $this->billedSession();

        $this->runRepair();
        $this->runRepair();

        $this->assertEquals(200, $invoice->fresh()->total_amount_ils);
        $this->assertSame(
            0,
            WorkItemToothStep::where('work_item_id', $workItem->id)->whereNull('completed_at')->whereNotNull('invoice_line_id')->count(),
        );
    }

    /** Whatever the repair does, it must leave no contradiction behind. */
    public function test_no_tooth_step_is_left_billed_and_unticked(): void
    {
        foreach ([true, false] as $pricePerTooth) {
            [$workItem] = $this->billedSession($pricePerTooth);

            foreach (WorkItemToothStep::where('work_item_id', $workItem->id)->get() as $toothStep) {
                $this->strand($toothStep);
            }
        }

        $this->runRepair();

        $this->assertSame(
            0,
            WorkItemToothStep::whereNull('completed_at')->whereNotNull('invoice_line_id')->count(),
        );
    }
}
