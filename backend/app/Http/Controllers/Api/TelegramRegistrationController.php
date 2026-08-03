<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\TelegramLink;
use App\Services\TelegramService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Handles chats that messaged the bot cold (no pre-existing staff /link
 * code) — they land here as a pending TelegramLink (registered_name/phone
 * set, user_id/patient_id/doctor_id all null) until the owner classifies
 * them as an existing staff member, a doctor, or a patient.
 */
class TelegramRegistrationController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        return TelegramLink::whereNotNull('registered_name')
            ->whereNull('user_id')
            ->whereNull('patient_id')
            ->whereNull('doctor_id')
            ->orderByDesc('created_at')
            ->get();
    }

    /**
     * Every doctor/patient already linked to a Telegram chat — for the
     * "شو مرتبط أصلاً" overview on the Telegram admin page, separate from
     * the pending (not-yet-classified) queue above.
     */
    public function linked(Request $request)
    {
        abort_unless($request->user()->can('settings.manage'), 403);

        $doctorLinks = TelegramLink::whereNotNull('linked_at')
            ->whereNotNull('doctor_id')
            ->with('doctor')
            ->orderByDesc('linked_at')
            ->get()
            ->map(fn (TelegramLink $l) => [
                'id' => $l->doctor?->id,
                'full_name' => $l->doctor?->full_name,
                'linked_at' => display_datetime($l->linked_at),
            ])
            ->filter(fn ($d) => $d['id'] !== null)
            ->values();

        $patientLinks = TelegramLink::whereNotNull('linked_at')
            ->whereNotNull('patient_id')
            ->with('patient')
            ->orderByDesc('linked_at')
            ->get()
            ->map(fn (TelegramLink $l) => [
                'id' => $l->patient?->id,
                'full_name' => $l->patient?->full_name,
                'phone' => $l->patient?->phone,
                'linked_at' => display_datetime($l->linked_at),
            ])
            ->filter(fn ($p) => $p['id'] !== null)
            ->values();

        return [
            'doctors' => $doctorLinks,
            'patients' => $patientLinks,
        ];
    }

    public function linkStaff(Request $request, TelegramLink $link, TelegramService $telegram)
    {
        abort_unless($request->user()->can('settings.manage'), 403);
        abort_if($link->user_id || $link->patient_id || $link->doctor_id, 422, 'هذا الطلب متصنّف مسبقاً.');

        $data = $request->validate(['user_id' => ['required', Rule::exists('users', 'id')]]);

        $existing = TelegramLink::where('user_id', $data['user_id'])->where('id', '!=', $link->id)->first();
        abort_if($existing, 422, 'هذا المستخدم مربوط بمحادثة تيليغرام تانية أصلاً.');

        $link->update(['user_id' => $data['user_id'], 'linked_at' => now()]);

        $keyboard = [['📅 مواعيد اليوم', '🗓 مواعيد الأسبوع']];
        if ($link->user?->hasAnyRole(['owner', 'accountant'])) {
            $keyboard[] = ['💰 كشف حساب مريض'];
            $keyboard[] = ['📋 بحث ديون', '🚚 كشف حساب مورد'];
        }
        $telegram->sendMessage((int) $link->telegram_chat_id, 'تم ربط حسابك بنجاح! ✅', $keyboard);

        return $link->fresh('user');
    }

    /**
     * Links a doctor's own Telegram chat directly to their Doctor record —
     * no code, no User login needed. This is the normal path for doctors
     * who just message the bot with their name; the owner picks which
     * Doctor row it is from the pending-registrations list.
     */
    public function linkDoctor(Request $request, TelegramLink $link, TelegramService $telegram)
    {
        abort_unless($request->user()->can('settings.manage'), 403);
        abort_if($link->user_id || $link->patient_id || $link->doctor_id, 422, 'هذا الطلب متصنّف مسبقاً.');

        $data = $request->validate(['doctor_id' => ['required', Rule::exists('doctors', 'id')]]);

        $existing = TelegramLink::where('doctor_id', $data['doctor_id'])->where('id', '!=', $link->id)->first();
        abort_if($existing, 422, 'هذا الطبيب مربوط بمحادثة تيليغرام تانية أصلاً.');

        $link->update(['doctor_id' => $data['doctor_id'], 'linked_at' => now()]);

        $telegram->sendMessage((int) $link->telegram_chat_id, 'تم ربط حسابك بنجاح! ✅', [['📅 مواعيد اليوم', '🗓 مواعيد الأسبوع']]);

        return $link->fresh('doctor');
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
            'تم ربط حسابك بملفك الطبي بنجاح! ✅',
            [
                ['📅 مواعيدي', '➕ حجز موعد'],
                ['💳 كشف حسابي', '💊 وصفاتي'],
                ['🦷 وضع أسناني'],
            ],
        );

        return $link->fresh('patient');
    }

    public function destroy(Request $request, TelegramLink $link, TelegramService $telegram)
    {
        abort_unless($request->user()->can('settings.manage'), 403);
        abort_if($link->user_id || $link->patient_id || $link->doctor_id, 422, 'هذا الطلب متصنّف مسبقاً — استخدم فك الربط بدلاً من الرفض.');

        $telegram->sendMessage((int) $link->telegram_chat_id, 'ما قدرنا نأكد طلب تسجيلك. تواصل مع العيادة مباشرة أو أعد المحاولة بمعلومات صحيحة.');

        $link->delete();

        return response()->noContent();
    }
}
