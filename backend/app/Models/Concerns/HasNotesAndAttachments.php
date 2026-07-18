<?php

namespace App\Models\Concerns;

use App\Models\Attachment;
use App\Models\Note;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * Apply to any model that can carry notes/attachments (patients, invoices,
 * checks, appointments, ...). Both tables are generic/polymorphic — see
 * docs/erd.md group 13.
 */
trait HasNotesAndAttachments
{
    public function notes(): MorphMany
    {
        return $this->morphMany(Note::class, 'notable');
    }

    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable');
    }
}
