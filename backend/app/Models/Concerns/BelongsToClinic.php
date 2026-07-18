<?php

namespace App\Models\Concerns;

use App\Models\Scopes\ClinicScope;
use App\Support\Tenancy\CurrentClinic;

/**
 * Apply to every tenant-owned model. Adds a global scope that filters
 * every query to the current clinic, and stamps clinic_id automatically
 * on creation. The model's table must have a clinic_id column.
 */
trait BelongsToClinic
{
    protected static function bootBelongsToClinic(): void
    {
        static::addGlobalScope(new ClinicScope);

        static::creating(function ($model): void {
            if (! $model->getAttribute('clinic_id')) {
                $model->setAttribute('clinic_id', CurrentClinic::id());
            }
        });
    }
}
