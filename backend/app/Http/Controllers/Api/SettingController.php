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
        'default_appointment_duration', 'base_currency', 'invoice_footer_note',
        'reminder_appointments_enabled', 'reminder_checks_enabled', 'reminder_lab_enabled',
        'notify_new_appointment_enabled',
        'clinic_hours_start', 'clinic_hours_end',
        'telegram_bot_token', 'telegram_bot_username', 'telegram_welcome_message',
        'daily_report_time', 'reminder_time',
        // { "USD": 3.7, "JOD": 5.2 } — how many shekels one unit is worth.
        // Kept as a setting so the rate is typed once here instead of from
        // memory on every foreign-currency payment.
        'exchange_rates',
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

            // Laravel's ConvertEmptyStringsToNull turns a blank text field into
            // null on the way in, and settings.value is NOT NULL — so clearing
            // any optional text setting (the invoice footer note, say) used to
            // fail the whole save with a 500. Store the blank instead.
            Setting::updateOrCreate(['key' => $key], ['value' => $value ?? '']);
        }

        // Same rule as the bootstrap payload: the token goes in, never out.
        return ['settings' => Setting::pluck('value', 'key')->except('telegram_bot_token')];
    }
}
