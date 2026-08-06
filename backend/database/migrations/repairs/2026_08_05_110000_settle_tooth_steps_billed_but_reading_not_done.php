<?php

use App\Models\WorkItemToothStep;
use App\Services\WorkItemService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * "طبّق نفس القيم على كل الأسنان" used to copy the source tooth's progress by
 * writing completed_at straight in. Copying an un-ticked source cleared the tick
 * on teeth that had already been invoiced but left invoice_line_id in place, so
 * the tooth read as "not done" while the patient stayed charged for it.
 *
 * There is no legitimate way to be in that state, so every such row is damage.
 * Per-tooth work is put back the way un-ticking it should have gone in the first
 * place: the charge comes off the invoice and the ledger. A flat-fee step can't
 * have one tooth's share handed back — its single invoice line covers every
 * tooth — so those get their tick restored instead, which is the other way to
 * make the bill and the chart agree, and leaves the money exactly where it is.
 */
return new class extends Migration
{
    public function up(): void
    {
        $stranded = DB::table('work_item_tooth_steps')
            ->whereNull('completed_at')
            ->whereNotNull('invoice_line_id')
            ->pluck('id');

        if ($stranded->isEmpty()) {
            return;
        }

        $service = app(WorkItemService::class);
        $reversed = 0;
        $reTicked = 0;

        foreach ($stranded as $id) {
            $toothStep = WorkItemToothStep::withoutGlobalScopes()->with('workItem')->find($id);

            if (! $toothStep || ! $toothStep->workItem) {
                continue;
            }

            CurrentClinic::set($toothStep->workItem->clinic_id);

            if ($toothStep->workItem->price_per_tooth) {
                // Put the tick back first: updateToothStep only reverses a
                // billed step when it is being turned off, and the row is
                // already off.
                $toothStep->update(['completed_at' => now()]);
                $service->updateToothStep($toothStep->fresh(), false, null);
                $reversed++;

                continue;
            }

            $toothStep->update(['completed_at' => $toothStep->workItem->updated_at ?? now()]);
            $reTicked++;
        }

        info(sprintf(
            'Settled %d tooth-steps that were billed but reading as not done: %d charges reversed, %d ticks restored.',
            $stranded->count(),
            $reversed,
            $reTicked,
        ));
    }

    /** Undoing a repair would only put the contradiction back. */
    public function down(): void {}
};
