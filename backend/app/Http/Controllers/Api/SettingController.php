<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use Illuminate\Http\Request;

class SettingController extends Controller
{
    /**
     * Free-form key/value settings update — used for the clinic profile
     * (name/phone/address/logo) that appears on printouts, and anything
     * else simple enough not to need its own dedicated endpoint. Every
     * key is whitelisted here on purpose so an arbitrary settings key
     * can't be injected from the client.
     */
    protected const ALLOWED_KEYS = [
        'clinic_name', 'clinic_phone', 'clinic_address', 'clinic_logo',
    ];

    public function update(Request $request)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        $data = $request->validate([
            'values' => ['required', 'array'],
        ]);

        foreach ($data['values'] as $key => $value) {
            if (! in_array($key, self::ALLOWED_KEYS, true)) {
                continue;
            }

            Setting::updateOrCreate(['key' => $key], ['value' => $value]);
        }

        return ['settings' => Setting::pluck('value', 'key')];
    }
}
