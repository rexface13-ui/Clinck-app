<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Laravel\Pennant\Feature;

/**
 * Registers every splittable feature key with Pennant. This is the one
 * place that lists them — never gate a feature elsewhere without adding
 * it here first. While saas_mode is off (local, single clinic) every key
 * resolves to true. Phase 5 swaps the resolver to read plan_features for
 * the clinic in scope.
 *
 * Usage everywhere else in the app: feature('bot'), feature('checks'), ...
 * (Pennant's own global helper — no separate wrapper needed.)
 */
class FeatureServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        foreach (config('dentaflow.feature_keys') as $key) {
            Feature::define($key, fn () => $this->resolve($key));
        }
    }

    protected function resolve(string $key): bool
    {
        if (! config('dentaflow.saas_mode')) {
            return true;
        }

        // Phase 5: look up $key against the current clinic's plan_features.
        return false;
    }
}
