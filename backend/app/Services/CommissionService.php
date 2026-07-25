<?php

namespace App\Services;

use App\Models\DoctorTransaction;
use App\Models\Setting;
use App\Models\ToothFinding;
use Illuminate\Support\Carbon;

class CommissionService
{
    /**
     * Fires when a finding's status becomes "done". Only contract types
     * with a commission component earn one — pure salary doctors are paid
     * outside the per-procedure flow. Basis is settings.commission_basis;
     * "completed" (the only basis implemented so far) means the commission
     * posts the moment the procedure is marked done.
     */
    public function computeForFinding(ToothFinding $finding, ?float $baseAmount = null): ?DoctorTransaction
    {
        if (! $finding->service_id || ! $finding->doctor_id) {
            return null;
        }

        $basis = Setting::query()->where('key', 'commission_basis')->first()?->value;
        if (($basis ?? 'completed') !== 'completed') {
            return null;
        }

        $finding->loadMissing(['doctor', 'service.branchPrices', 'patient']);
        $doctor = $finding->doctor;

        if ($doctor->contract_type === 'salary') {
            return null;
        }

        $percent = $doctor->serviceCommissions()
            ->where('service_id', $finding->service_id)
            ->value('commission_percent') ?? $doctor->default_commission_percent;

        if (! $percent) {
            return null;
        }

        $baseAmount ??= $finding->service->priceForBranch($finding->patient->branch);
        $commissionIls = round($baseAmount * $percent / 100, 2);

        return DoctorTransaction::updateOrCreate(
            ['tooth_finding_id' => $finding->id, 'type' => 'commission'],
            [
                'clinic_id' => $finding->clinic_id,
                'doctor_id' => $doctor->id,
                'amount_ils' => $commissionIls,
                'period_month' => Carbon::parse($finding->recorded_at)->startOfMonth(),
            ],
        );
    }
}
