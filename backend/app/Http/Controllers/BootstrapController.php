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

        // The bot token is a secret — never send it to the frontend, even
        // to a logged-in owner. The Settings page treats it write-only.
        $settings = Setting::pluck('value', 'key')->except('telegram_bot_token');

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
