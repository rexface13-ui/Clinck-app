<?php

namespace App\Models;

use App\Models\Concerns\BelongsToClinic;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WorkItem extends Model
{
    use BelongsToClinic;

    protected $fillable = ['clinic_id', 'patient_id', 'doctor_id', 'service_id', 'appointment_id', 'price_per_tooth', 'status', 'collected_amount_ils'];

    protected function casts(): array
    {
        return ['price_per_tooth' => 'boolean', 'collected_amount_ils' => 'float'];
    }

    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function doctor(): BelongsTo
    {
        return $this->belongsTo(Doctor::class);
    }

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }

    public function appointment(): BelongsTo
    {
        return $this->belongsTo(Appointment::class);
    }

    public function teeth(): HasMany
    {
        return $this->hasMany(WorkItemTooth::class);
    }

    public function steps(): HasMany
    {
        return $this->hasMany(WorkItemStep::class)->orderBy('sort_order');
    }

    public function toothSteps(): HasMany
    {
        return $this->hasMany(WorkItemToothStep::class);
    }

    public function toothNumbers(): array
    {
        return $this->teeth->pluck('tooth_number')->map(fn ($n) => (int) $n)->all();
    }

    /**
     * What was actually collected against this session, derived from the real
     * payments on the invoice(s) its work was billed into.
     *
     * Deliberately NOT read from the `collected_amount_ils` column: checkout()
     * never wrote that column, so it read 0 for every session the patient had
     * already paid for. The edit-session form seeded its "المبلغ المحصّل" input
     * from it, so "correcting" 0 back to the true figure was treated as a brand
     * new collection and charged the patient a second time. Deriving it here
     * means the figure can never drift out of sync with the money, no matter
     * which screen the payment was entered, edited, or deleted from.
     *
     * One checkout can bill several sessions onto a single invoice, and one
     * session's steps can end up spread across several invoices over time, so
     * each invoice's payments are split across the sessions on it in proportion
     * to what each session actually contributed to that invoice's lines.
     */
    /** What this session was actually billed — the sum of its invoice lines. */
    public function billedAmountIls(): float
    {
        $this->loadMissing('toothSteps.invoiceLine');

        return round((float) $this->toothSteps
            ->map(fn ($toothStep) => $toothStep->invoiceLine)
            ->filter()
            ->unique('id')
            ->sum('amount_ils'), 2);
    }

    public function actualCollectedIls(): float
    {
        $this->loadMissing('toothSteps.invoiceLine.invoice.payments', 'toothSteps.invoiceLine.invoice.lines');

        $lines = $this->toothSteps
            ->map(fn ($toothStep) => $toothStep->invoiceLine)
            ->filter()
            ->unique('id');

        $collected = 0.0;

        foreach ($lines->groupBy('invoice_id') as $group) {
            $invoice = $group->first()->invoice;

            if (! $invoice) {
                continue;
            }

            // The settled figure, not the payments on this invoice — a session
            // paid by check (or by a lump sum with no invoice picked) has no
            // payment row against it and would otherwise report 0 collected,
            // walking straight back into the double-charge this method exists
            // to prevent.
            $paid = (float) $invoice->settled_amount_ils;
            $invoiceLinesTotal = (float) $invoice->lines->sum('amount_ils');

            if ($paid <= 0 || $invoiceLinesTotal <= 0) {
                continue;
            }

            $collected += $paid * ((float) $group->sum('amount_ils') / $invoiceLinesTotal);
        }

        return round($collected, 2);
    }
}
