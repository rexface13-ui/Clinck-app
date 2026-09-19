<?php

namespace App\Support;

use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\WorkItemToothStep;
use Illuminate\Support\Collection;

/**
 * What a billed session is called on screen — "جلسة: علاج عصب — سن 16" —
 * instead of an opaque invoice number nobody at the desk thinks in.
 * Several pieces of work on one visit read as the first one plus a count
 * ("... +2"), so the label stays one short line.
 */
class SessionLabel
{
    public static function forInvoice(Invoice $invoice): string
    {
        return self::forInvoices([$invoice])[$invoice->id];
    }

    /**
     * @param  iterable<Invoice>  $invoices
     * @return array<int, string> invoice id => label
     */
    public static function forInvoices(iterable $invoices): array
    {
        $invoices = collect($invoices);
        $ids = $invoices->pluck('id')->all();
        if (! $ids) {
            return [];
        }

        $linesByInvoice = InvoiceLine::withoutGlobalScopes()
            ->whereIn('invoice_id', $ids)
            ->with(['workItemToothStep.workItem.service:id,name', 'workItemToothStep.workItem.steps:id,work_item_id', 'workItemToothStep.step:id,title'])
            ->orderBy('id')
            ->get()
            ->groupBy('invoice_id');

        // A flat-fee line covers several teeth at once — every tooth tagged to the line, not just the first.
        $teethByLine = WorkItemToothStep::withoutGlobalScopes()
            ->whereIn('invoice_line_id', $linesByInvoice->flatten(1)->pluck('id'))
            ->get(['invoice_line_id', 'tooth_number'])
            ->groupBy('invoice_line_id');

        $labels = [];
        foreach ($invoices as $invoice) {
            $labels[$invoice->id] = self::build($linesByInvoice->get($invoice->id, collect()), $teethByLine);
        }

        return $labels;
    }

    private static function build(Collection $lines, Collection $teethByLine): string
    {
        $parts = [];

        foreach ($lines->groupBy(fn (InvoiceLine $l) => $l->workItemToothStep?->workItem?->id ?? 'none') as $group) {
            $first = $group->first();
            $workItem = $first->workItemToothStep?->workItem;
            $name = $workItem?->service?->name ?? ($first->description ?: 'شغل');

            // A multi-step treatment (root canal, crown...) is billed a step at a time — say which one.
            if ($workItem && $workItem->steps->count() > 1) {
                $titles = $group->map(fn ($l) => $l->workItemToothStep?->step?->title)->filter()->unique()->values();
                if ($titles->isNotEmpty()) {
                    $name .= ' ('.$titles->implode('، ').')';
                }
            }

            $teeth = $group
                ->flatMap(fn ($l) => $teethByLine->get($l->id, collect())->pluck('tooth_number')->map(fn ($n) => (int) $n))
                ->push(...$group->map(fn ($l) => $l->workItemToothStep?->tooth_number)->filter()->map(fn ($n) => (int) $n)->all())
                ->unique()->sort()->values();

            $parts[] = $teeth->isEmpty() ? $name : $name.' — '.($teeth->count() === 1 ? 'سن ' : 'أسنان ').$teeth->implode('، ');
        }

        if (! $parts) {
            return 'جلسة';
        }

        return 'جلسة: '.$parts[0].(count($parts) > 1 ? ' +'.(count($parts) - 1) : '');
    }
}
