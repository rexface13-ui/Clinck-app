<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A session's done/in-progress status was worked out at checkout and never
 * again, so any later correction left it stale: un-ticking a tooth of a
 * finished session kept it reading "منجز" (and off the list of work the patient
 * still owes a visit for), while ticking the last pending tooth outside a
 * checkout left it reading "قيد التنفيذ" forever.
 *
 * The status is purely derived — a session is done exactly when every one of
 * its tooth-steps is ticked — so it can simply be recomputed. Cancelled
 * sessions are left alone: that is a decision, not a progress state.
 */
return new class extends Migration
{
    public function up(): void
    {
        $corrected = DB::update("
            update work_items wi
            set status = derived.correct_status
            from (
                select ts.work_item_id,
                       case when bool_and(ts.completed_at is not null) then 'done' else 'in_progress' end as correct_status
                from work_item_tooth_steps ts
                group by ts.work_item_id
            ) as derived
            where wi.id = derived.work_item_id
              and wi.status <> 'cancelled'
              and wi.status <> derived.correct_status
        ");

        info(sprintf('Recomputed %d session statuses that disagreed with their own teeth.', $corrected));
    }

    /** Putting a stale status back would only re-break the list of open work. */
    public function down(): void {}
};
