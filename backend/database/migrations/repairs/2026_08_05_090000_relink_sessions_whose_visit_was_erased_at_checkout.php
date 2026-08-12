<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Checking out without naming an appointment used to write appointment_id = null
 * over every session in the checkout, wiping the visit a session was already
 * booked under. The work then disappeared from that visit's history, and the
 * guard that stops a billed visit being deleted no longer saw it.
 *
 * The link itself isn't stored anywhere else, so it can only be inferred. This
 * restores it ONLY where there is no room for doubt: the session was billed on a
 * day when that patient had exactly one visit, and that visit was marked done.
 * Anything ambiguous is left alone — a wrong visit in a clinical record is worse
 * than a missing one.
 */
return new class extends Migration
{
    public function up(): void
    {
        $candidates = DB::select("
            with billed as (
                select wi.id, wi.patient_id, min(i.issued_at::date) as billed_on
                from work_items wi
                join work_item_tooth_steps ts on ts.work_item_id = wi.id
                join invoice_lines il on il.id = ts.invoice_line_id
                join invoices i on i.id = il.invoice_id
                where wi.appointment_id is null
                group by wi.id, wi.patient_id
            )
            select b.id as work_item_id,
                   min(a.id) as appointment_id,
                   count(a.id) as visits_that_day
            from billed b
            join appointments a
              on a.patient_id = b.patient_id
             and a.starts_at::date = b.billed_on
             and a.status = 'done'
            group by b.id
        ");

        $unambiguous = array_filter($candidates, fn ($row) => (int) $row->visits_that_day === 1);

        DB::transaction(function () use ($unambiguous) {
            foreach ($unambiguous as $row) {
                DB::table('work_items')
                    ->where('id', $row->work_item_id)
                    ->whereNull('appointment_id')
                    ->update(['appointment_id' => $row->appointment_id]);
            }
        });

        info(sprintf(
            'Relinked %d of %d billed sessions to the visit they were recorded under; %d left unlinked as ambiguous.',
            count($unambiguous),
            count($candidates),
            count($candidates) - count($unambiguous),
        ));
    }

    /**
     * Restoring a link that was lost to a bug isn't something to undo — and the
     * previous value was null for every row touched, which is what the bug wrote.
     */
    public function down(): void {}
};
