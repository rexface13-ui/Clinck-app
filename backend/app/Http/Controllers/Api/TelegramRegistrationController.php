<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Patient;
use App\Models\TelegramLink;
use App\Services\TelegramService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Handles chats that messaged the bot cold (no pre-existing staff /link
 * code) — they land here as a pending TelegramLink (registered_name/phone
 * set, user_id and patient_id both null) until the owner classifies them
 * as either an existing staff member or a patient.
 */
class TelegramRegistrationController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        return TelegramLink::whereNotNull('registered_name')
            ->whereNull('user_id')
            ->whereNull('patient_id')
            ->orderByDesc('created_at')
            ->get();
    }

    public function linkStaff(Request $request, TelegramLink $link, TelegramService $telegram)
    {
        abort_unless($request->user()->can('settings.manage'), 403);
        abort_if($link->user_id || $link->patient_id, 422, 'هذا الطلب متصنّف مسبقاً.');

        $data = $request->validate(['user_id' => ['required', Rule::exists('users', 'id')]]);

        $existing = TelegramLink::where('user_id', $data['user_id'])->where('id', '!=', $link->id)->first();
        abort_if($existing, 422, 'هذا المستخدم مربوط بمحادثة تيليغرام تانية أصلاً.');

        $link->update(['user_id' => $data['user_id'], 'linked_at' => now()]);

        $telegram->sendMessage((int) $link->telegram_chat_id, 'تم ربط حسابك بنجاح! أرسل /appointments لعرض مواعيد اليوم.');

        return $link->fresh('user');
    }

    public function linkPatient(Request $request, TelegramLink $link, TelegramService $telegram)
    {
        abort_unless($request->user()->can('settings.manage'), 403);
        abort_if($link->user_id || $link->patient_id, 422, 'هذا الطلب متصنّف مسبقاً.');

        $data = $request->validate([
            'patient_id' => ['nullable', Rule::exists('patients', 'id')],
            'branch_id' => ['required_without:patient_id', Rule::exists('branches', 'id')],
            'gender' => ['required_without:patient_id', Rule::in(['male', 'female'])],
        ]);

        $patient = $data['patient_id'] ?? null
            ? Patient::findOrFail($data['patient_id'])
            : Patient::create([
                'branch_id' => $data['branch_id'] ?? Branch::where('is_main', true)->value('id'),
                'full_name' => $link->registered_name,
                'phone' => $link->registered_phone,
                'gender' => $data['gender'] ?? 'male',
            ]);

        $existing = TelegramLink::where('patient_id', $patient->id)->where('id', '!=', $link->id)->first();
        abort_if($existing, 422, 'هذا المريض مربوط بمحادثة تيليغرام تانية أصلاً.');

        $link->update(['patient_id' => $patient->id, 'linked_at' => now()]);

        $telegram->sendMessage(
            (int) $link->telegram_chat_id,
            "تم ربط حسابك بملفك الطبي بنجاح!\nالأوامر المتاحة:\n/appointments — مواعيدي القادمة\n/account — كشف حسابي",
        );

        return $link->fresh('patient');
    }

    public function destroy(Request $request, TelegramLink $link, TelegramService $telegram)
    {
        abort_unless($request->user()->can('settings.manage'), 403);
        abort_if($link->user_id || $link->patient_id, 422, 'هذا الطلب متصنّف مسبقاً — استخدم فك الربط بدلاً من الرفض.');

        $telegram->sendMessage((int) $link->telegram_chat_id, 'ما قدرنا نأكد طلب تسجيلك. تواصل مع العيادة مباشرة أو أعد المحاولة بمعلومات صحيحة.');

        $link->delete();

        return response()->noContent();
    }
}
