<?php

namespace App\Http\Controllers;

use App\Models\Setting;
use Illuminate\Http\Request;

class BootstrapController extends Controller
{
    public function __invoke(Request $request)
    {
        $user = $request->user();

        $features = collect(config('dentaflow.feature_keys'))
            ->mapWithKeys(fn (string $key) => [$key => feature($key)]);

        $settings = Setting::pluck('value', 'key');

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
            'roles' => $user->getRoleNames(),
            'permissions' => $user->getAllPermissions()->pluck('name'),
            'features' => $features,
            'settings' => $settings,
            'branches' => $user->branches()->get(['branches.id', 'branches.name', 'branches.is_main']),
        ]);
    }
}
