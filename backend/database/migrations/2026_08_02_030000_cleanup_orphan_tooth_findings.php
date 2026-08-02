<?php

use App\Models\ToothFinding;
use App\Models\WorkItemToothStep;
use Illuminate\Database\Migrations\Migration;

/**
 * Before recomputeToothFinding() existed (see WorkItemService::removeTooth),
 * removing a tooth from a work item deleted the work-item rows but left the
 * ToothFinding record behind untouched — so the chart kept showing the
 * tooth in its old service color forever, even though the work itself was
 * gone. This applies the same rule recomputeToothFinding() now enforces
 * going forward, once, retroactively to every clinic's existing data.
 *
 * Only ever touches findings that came FROM a work item
 * (work_item_tooth_step_id set) — a manually-entered finding (a free note,
 * or "performed externally" flagged with a service for its color) has no
 * tooth step behind it at all and is never in scope here.
 */
return new class extends Migration
{
    public function up(): void
    {
        $deleted = 0;
        $updated = 0;

        ToothFinding::whereNotNull('service_id')
            ->whereNotNull('work_item_tooth_step_id')
            ->withoutGlobalScopes()
            ->chunkById(200, function ($findings) use (&$deleted, &$updated) {
                foreach ($findings as $finding) {
                    $steps = WorkItemToothStep::withoutGlobalScopes()
                        ->where('tooth_number', $finding->tooth_number)
                        ->whereHas('workItem', fn ($q) => $q->withoutGlobalScopes()
                            ->where('patient_id', $finding->patient_id)
                            ->where('service_id', $finding->service_id)
                            ->where('status', '!=', 'cancelled'))
                        ->get();

                    $completedCount = $steps->filter(fn ($ts) => $ts->completed_at)->count();

                    if ($completedCount === 0) {
                        $finding->delete();
                        $deleted++;

                        continue;
                    }

                    $status = $completedCount === $steps->count() ? 'done' : 'in_progress';
                    if ($finding->status !== $status) {
                        $finding->update(['status' => $status]);
                        $updated++;
                    }
                }
            });

        info("cleanup_orphan_tooth_findings: deleted={$deleted} updated={$updated}");
    }

    public function down(): void
    {
        // Not reversible — the whole point is removing findings that no
        // longer correspond to any real work; nothing to roll back to.
    }
};
