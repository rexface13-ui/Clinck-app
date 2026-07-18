<?php

namespace App\Policies;

use App\Models\TreatmentPlan;
use App\Models\User;

class TreatmentPlanPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->can('treatment_plans.view');
    }

    public function view(User $user, TreatmentPlan $plan): bool
    {
        return $user->can('treatment_plans.view');
    }

    public function create(User $user): bool
    {
        return $user->can('treatment_plans.manage');
    }

    public function update(User $user, TreatmentPlan $plan): bool
    {
        return $user->can('treatment_plans.manage');
    }

    public function delete(User $user, TreatmentPlan $plan): bool
    {
        return $user->can('treatment_plans.manage') && $plan->status === 'draft';
    }
}
