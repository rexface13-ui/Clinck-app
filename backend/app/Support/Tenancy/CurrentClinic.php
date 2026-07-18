<?php

namespace App\Support\Tenancy;

class CurrentClinic
{
    /**
     * Resolve the active clinic_id for the current request/console context.
     *
     * Local single-clinic mode always resolves to the configured
     * local_clinic_id. Multi-clinic (SaaS) resolution — from the
     * authenticated user's clinic, a subdomain, etc. — is wired in
     * during Phase 5.
     */
    public static function id(): int
    {
        if (app()->bound('currentClinicId')) {
            return (int) app('currentClinicId');
        }

        return (int) config('dentaflow.local_clinic_id');
    }

    /**
     * Override the resolved clinic_id for the current app instance.
     * Used by tests and, later, by SaaS request-scoped resolution.
     */
    public static function set(int $clinicId): void
    {
        app()->instance('currentClinicId', $clinicId);
    }
}
