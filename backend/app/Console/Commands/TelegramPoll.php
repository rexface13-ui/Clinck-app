<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\CheckModel;
use App\Models\Doctor;
use App\Models\DoctorTransaction;
use App\Models\Note;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\Supplier;
use App\Models\TelegramLink;
use App\Models\ToothFinding;
use App\Models\User;
use App\Services\CheckService;
use App\Services\DoctorSlotService;
use App\Services\TelegramService;
use App\Support\Arabic;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;

class TelegramPoll extends Command
{
    protected $signature = 'telegram:poll';

    protected $description = 'Long-poll the Telegram Bot API for updates and handle a fully button-driven chat flow';

    // Registration (unlinked chats)
    protected const BTN_STAFF_LOGIN = '👔 عندي حساب دخول بالنظام';

    protected const BTN_DOCTOR = '🦷 أنا طبيب';

    protected const BTN_PATIENT = '🧑 أنا مريض';

    // Staff
    protected const BTN_TODAY = '📅 مواعيد اليوم';

    protected const BTN_WEEK = '🗓 مواعيد الأسبوع';

    protected const BTN_PATIENT_ACCOUNT = '💰 كشف حساب مريض';

    protected const BTN_DEBTS = '📋 بحث ديون';

    protected const BTN_SUPPLIER = '🚚 كشف حساب مورد';

    protected const BTN_MY_COMMISSION = '💰 عمولتي الشهر';

    protected const BTN_SEARCH_PATIENT = '🔍 بحث عن مريض';

    // Patient
    protected const BTN_MY_APPOINTMENTS = '📅 مواعيدي';

    protected const BTN_BOOK = '➕ حجز موعد';

    protected const BTN_MY_ACCOUNT = '💳 كشف حسابي';

    protected const BTN_PRESCRIPTIONS = '💊 وصفاتي';

    protected const BTN_TEETH = '🦷 وضع أسناني';

    protected const BTN_CANCEL_BOOKING = '❌ إلغاء الحجز';

    protected const BTN_TODAY_SHORT = 'اليوم';

    protected const BTN_TOMORROW = 'بكرا';

    /**
     * Which button/prompt an *unlinked* chat is currently answering — kept
     * in memory (not the DB) since these chats have no TelegramLink row
     * yet and telegram_chat_id is unique, so persisting a half-registered
     * row here would collide with the real one once they actually link.
     * Lost on process restart, which just means the person re-taps a
     * button — harmless.
     */
    protected array $unlinkedIntent = [];

    /**
     * starts_at/ends_at are stored UTC (timestamptz) — every place that
     * turns one into text for a chat message must convert to the clinic's
     * display timezone first, same as DateFormatter does for the web UI,
     * or times come out shifted by the UTC offset (this bit us once
     * already: a bot-composed message showed times ~3 hours off).
     */
    protected function localTime(Carbon $value, string $format): string
    {
        return $value->clone()->timezone(config('dentaflow.display_timezone'))->format($format);
    }

    public function handle(TelegramService $telegram, CheckService $checkService): int
    {
        if ($telegram->token() === '') {
            $this->warn('التوكن غير معرّف بعد — من صفحة تيليغرام على الموقع. الأمر متوقف.');

            return self::SUCCESS;
        }

        $this->info('بدء استماع بوت تيليغرام (Ctrl+C للإيقاف)...');
        $offset = 0;

        while (true) {
            $updates = $telegram->getUpdates($offset);

            foreach ($updates as $update) {
                $offset = max($offset, $update['update_id'] + 1);
                $this->handleUpdate($update, $telegram, $checkService);
            }

            if (empty($updates)) {
                sleep(2);
            }
        }
    }

    protected function handleUpdate(array $update, TelegramService $telegram, CheckService $checkService): void
    {
        $message = $update['message'] ?? null;
        if (! $message || ! isset($message['chat']['id'])) {
            return;
        }

        $chatId = (int) $message['chat']['id'];
        $text = trim($message['text'] ?? '');
        $photos = $message['photo'] ?? null;

        // Commands run outside HTTP context — bind clinic before any query.
        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        $link = TelegramLink::where('telegram_chat_id', $chatId)->whereNotNull('linked_at')->first();

        if ($link && $link->user_id) {
            $this->handleStaffMessage($chatId, $text, $photos, $link, $telegram, $checkService);

            return;
        }

        if ($link && $link->patient_id) {
            $this->handlePatientMessage($chatId, $text, $link, $telegram);

            return;
        }

        if ($link && $link->doctor_id) {
            $this->handleDoctorMessage($chatId, $text, $photos, $link, $telegram, $checkService);

            return;
        }

        // Not yet linked at all — either just starting, mid-registration,
        // or already submitted and waiting on the owner to classify them.
        $this->handleUnlinkedMessage($chatId, $text, $telegram);
    }

    // ---------------------------------------------------------------
    // Unlinked chats: two buttons decide the path, no commands typed.
    // ---------------------------------------------------------------

    protected function handleUnlinkedMessage(int $chatId, string $text, TelegramService $telegram): void
    {
        $pendingReview = TelegramLink::where('telegram_chat_id', $chatId)->whereNull('linked_at')->whereNotNull('registered_name')->first();
        if ($pendingReview) {
            $telegram->sendMessage($chatId, 'طلب تسجيلك لسا قيد المراجعة من إدارة العيادة، رح نعلمك أول ما يتفعّل.', []);

            return;
        }

        if ($text === self::BTN_STAFF_LOGIN) {
            $this->unlinkedIntent[$chatId] = 'staff';
            $telegram->sendMessage($chatId, 'ابعتلي الكود يلي أعطتك ياه إدارة العيادة (تلاقيه إنت بنفسك من صفحة الإعدادات — "ربط تيليغرام").', []);

            return;
        }

        if ($text === self::BTN_DOCTOR || $text === self::BTN_PATIENT) {
            $this->unlinkedIntent[$chatId] = 'name';
            $telegram->sendMessage($chatId, 'اكتبلي اسمك الكامل:', []);

            return;
        }

        $intent = $this->unlinkedIntent[$chatId] ?? null;

        if ($intent === 'staff' && $text !== '' && $text !== '/start') {
            $this->tryStaffCode($chatId, $text, $telegram);

            return;
        }

        if ($intent === 'name' && $text !== '' && $text !== '/start') {
            $this->tryRegisterByName($chatId, $text, $telegram);

            return;
        }

        $telegram->sendMessage(
            $chatId,
            'أهلاً بك! 👋 اختر واحد من الأزرار تحت 👇',
            [[self::BTN_PATIENT], [self::BTN_DOCTOR], [self::BTN_STAFF_LOGIN]],
        );
    }

    protected function tryStaffCode(int $chatId, string $text, TelegramService $telegram): void
    {
        $code = trim($text);
        $link = TelegramLink::where('link_code', $code)->whereNull('linked_at')->first();

        if (! $link) {
            $telegram->sendMessage($chatId, 'كود غير صحيح أو منتهي. تأكد منه من إدارة العيادة وأعد المحاولة.');

            return;
        }

        $link->update(['telegram_chat_id' => $chatId, 'linked_at' => now()]);
        unset($this->unlinkedIntent[$chatId]);

        $telegram->sendMessage($chatId, 'تم ربط حسابك بنجاح! ✅', $this->staffKeyboard($link->user));
    }

    /**
     * Just the name — used for both "أنا طبيب" and "أنا مريض" alike, since
     * neither has a code to type; the owner picks which one they actually
     * are (and, for a patient, still fills in branch/gender for a
     * brand-new record) from the pending-registrations list on /telegram.
     */
    protected function tryRegisterByName(int $chatId, string $text, TelegramService $telegram): void
    {
        $name = trim($text);

        if (mb_strlen($name) < 2) {
            $telegram->sendMessage($chatId, 'الاسم قصير كتير، اكتبلي اسمك الكامل.');

            return;
        }

        TelegramLink::updateOrCreate(
            ['telegram_chat_id' => $chatId],
            ['registered_name' => $name, 'linked_at' => null],
        );
        unset($this->unlinkedIntent[$chatId]);

        $telegram->sendMessage($chatId, 'تم استلام طلبك! رح تنراجع من إدارة العيادة وبنعلمك أول ما يتفعّل حسابك.', []);
    }

    // ---------------------------------------------------------------
    // Staff (user_id-linked)
    // ---------------------------------------------------------------

    protected function staffKeyboard(?User $user): array
    {
        $rows = [[self::BTN_TODAY, self::BTN_WEEK]];

        if ($user?->doctor) {
            $rows[] = [self::BTN_MY_COMMISSION, self::BTN_SEARCH_PATIENT];
        }

        if ($user?->hasAnyRole(['owner', 'accountant'])) {
            $rows[] = [self::BTN_PATIENT_ACCOUNT];
            $rows[] = [self::BTN_DEBTS, self::BTN_SUPPLIER];
        }

        return $rows;
    }

    protected function handleStaffMessage(int $chatId, string $text, ?array $photos, TelegramLink $link, TelegramService $telegram, CheckService $checkService): void
    {
        if ($photos && $link->pending_check_id) {
            $this->handleCheckPhotoReply($chatId, $photos, $link, $telegram, $checkService, $this->staffKeyboard($link->user));

            return;
        }

        $user = $link->user;
        $keyboard = $this->staffKeyboard($user);

        if ($text === self::BTN_TODAY || $text === '/start') {
            $this->handleAppointments($chatId, $link, $telegram, 0, $keyboard);

            return;
        }

        if ($text === self::BTN_WEEK) {
            $this->handleAppointments($chatId, $link, $telegram, 6, $keyboard);

            return;
        }

        if ($text === self::BTN_MY_COMMISSION && $user?->doctor) {
            $this->handleCommissionStatement($chatId, $user->doctor, $telegram, $keyboard);

            return;
        }

        if ($text === self::BTN_SEARCH_PATIENT && $user?->doctor) {
            $link->update(['pending_intent' => 'doctor_patient_search']);
            $telegram->sendMessage($chatId, 'اكتبلي اسم المريض للبحث.', []);

            return;
        }

        if ($user?->doctor && $link->pending_intent === 'doctor_patient_search' && $text !== '') {
            $this->searchPatientsForDoctor($chatId, $text, $link, $telegram, $keyboard);

            return;
        }

        // A patient-name button tapped from a results list (either the last
        // appointments list or a name search) — only applies to a staff
        // member who's also a doctor (their own schedule is unambiguous);
        // owners/accountants see every doctor's patients, too long a button
        // set to be worth it there.
        if ($user?->doctor && $link->pending_intent && str_starts_with($link->pending_intent, 'doctor_patient_pick:') && $text !== '') {
            $daysAhead = (int) substr($link->pending_intent, strlen('doctor_patient_pick:'));
            $this->sendPatientDetailToDoctor($chatId, $user->doctor, $text, $daysAhead, $telegram, $keyboard);

            return;
        }

        if ($user?->doctor && $link->pending_intent === 'doctor_patient_search_pick' && $text !== '') {
            $this->sendAnyPatientDetailToDoctor($chatId, $text, $telegram, $keyboard);

            return;
        }

        $isPrivileged = $user?->hasAnyRole(['owner', 'accountant']);

        if ($text === self::BTN_PATIENT_ACCOUNT && $isPrivileged) {
            $link->update(['pending_intent' => 'account_search']);
            $telegram->sendMessage($chatId, 'ابعتلي كود المريض (مثال: P-000001).', []);

            return;
        }

        if ($text === self::BTN_DEBTS && $isPrivileged) {
            $link->update(['pending_intent' => 'debts_search']);
            $telegram->sendMessage($chatId, 'ابعتلي اسم المريض للبحث، أو اكتب "الكل" لعرض أعلى الديون.', []);

            return;
        }

        if ($text === self::BTN_SUPPLIER && $isPrivileged) {
            $link->update(['pending_intent' => 'supplier_search']);
            $telegram->sendMessage($chatId, 'ابعتلي اسم المورد.', []);

            return;
        }

        if ($isPrivileged && $link->pending_intent && $text !== '') {
            $intent = $link->pending_intent;
            $link->update(['pending_intent' => null]);

            match ($intent) {
                'account_search' => $this->handleAccount($chatId, $text, $telegram, $keyboard),
                'debts_search' => $this->handleDebtsSearch($chatId, $text, $telegram, $keyboard),
                'supplier_search' => $this->handleSupplierSearch($chatId, $text, $telegram, $keyboard),
                default => null,
            };

            return;
        }

        $telegram->sendMessage($chatId, 'اختر من الأزرار تحت 👇', $keyboard);
    }

    protected function handleAppointments(int $chatId, TelegramLink $link, TelegramService $telegram, int $daysAhead, array $keyboard): void
    {
        $user = $link->user;
        $query = Appointment::with(['patient:id,full_name', 'doctor:id,full_name'])
            ->whereBetween('starts_at', [Carbon::today(), Carbon::today()->addDays($daysAhead)->endOfDay()])
            ->whereIn('status', ['scheduled', 'confirmed'])
            ->orderBy('starts_at');

        if ($user?->doctor) {
            $query->where('doctor_id', $user->doctor->id);
        }

        $appointments = $query->get();

        if ($appointments->isEmpty()) {
            $link->update(['pending_intent' => null]);
            $telegram->sendMessage($chatId, 'لا يوجد مواعيد بهذا النطاق — الوقت فاضي. 🟢', $keyboard);

            return;
        }

        $lines = $appointments->map(fn (Appointment $a) => sprintf(
            '%s — %s (د. %s)',
            $this->localTime($a->starts_at, 'd/m H:i'),
            $a->patient?->full_name,
            $a->doctor?->full_name,
        ));

        if ($user?->doctor) {
            $link->update(['pending_intent' => "doctor_patient_pick:{$daysAhead}"]);
            $patientRows = $appointments->pluck('patient.full_name')->filter()->unique()->map(fn ($name) => [$name])->values()->all();
            $telegram->sendMessage(
                $chatId,
                "المواعيد:\n".$lines->implode("\n")."\n\nاضغط اسم أي مريض تحت لتشوف تفاصيله 👇",
                array_merge($patientRows, $keyboard),
            );

            return;
        }

        $telegram->sendMessage($chatId, "المواعيد:\n".$lines->implode("\n"), $keyboard);
    }

    protected function handleAccount(int $chatId, string $text, TelegramService $telegram, array $keyboard): void
    {
        $code = trim($text);
        $patient = Patient::where('code', $code)->first();

        if (! $patient) {
            $telegram->sendMessage($chatId, 'ما لقيت مريض بهذا الكود.', $keyboard);

            return;
        }

        $balance = $patient->transactions()->sum('amount_ils');
        $telegram->sendMessage($chatId, sprintf('كشف حساب %s: الرصيد الحالي %s ₪', $patient->full_name, number_format((float) $balance, 2)), $keyboard);
    }

    protected function handleDebtsSearch(int $chatId, string $text, TelegramService $telegram, array $keyboard): void
    {
        $term = trim($text);
        $term = $term === 'الكل' ? '' : $term;

        // Simplest correct debt search: pull outstanding balance per matching
        // patient directly, same signed-sum convention as DebtController.
        $patients = Patient::query()
            ->when($term !== '', fn ($q) => $q->where('full_name', 'like', "%{$term}%"))
            ->get(['id', 'full_name', 'code']);

        $withDebt = $patients->map(function (Patient $p) {
            $balance = $p->transactions()->sum('amount_ils');

            return $balance > 0 ? [$p, $balance] : null;
        })->filter()->sortByDesc(fn ($row) => $row[1])->take(15);

        if ($withDebt->isEmpty()) {
            $telegram->sendMessage($chatId, $term !== '' ? 'ما لقيت مرضى بهالاسم عليهم دين.' : 'ما في مرضى عليهم دين حالياً.', $keyboard);

            return;
        }

        $lines = $withDebt->map(fn ($row) => sprintf('%s (%s) — %s ₪', $row[0]->full_name, $row[0]->code, number_format((float) $row[1], 2)));
        $telegram->sendMessage($chatId, "المرضى الأعلى ديناً:\n".$lines->implode("\n"), $keyboard);
    }

    protected function handleSupplierSearch(int $chatId, string $text, TelegramService $telegram, array $keyboard): void
    {
        $term = trim($text);

        $suppliers = Supplier::where('name', 'like', "%{$term}%")->limit(10)->get();

        if ($suppliers->isEmpty()) {
            $telegram->sendMessage($chatId, 'ما لقيت مورد بهالاسم.', $keyboard);

            return;
        }

        $lines = $suppliers->map(function (Supplier $s) {
            $balance = $s->transactions()->sum('amount_ils');

            return sprintf('%s — مستحق %s ₪', $s->name, number_format((float) $balance, 2));
        });

        $telegram->sendMessage($chatId, "نتائج البحث:\n".$lines->implode("\n"), $keyboard);
    }

    /**
     * A staff member with an outstanding photo request (set via "طلب صورة
     * عبر تيليغرام" on a check) replies with a photo — download the
     * largest size Telegram sent, attach it to that specific check, and
     * clear the pending request.
     */
    protected function handleCheckPhotoReply(int $chatId, array $photos, TelegramLink $link, TelegramService $telegram, CheckService $checkService, array $keyboard): void
    {
        $check = CheckModel::find($link->pending_check_id);
        if (! $check) {
            $link->update(['pending_check_id' => null, 'pending_check_slot' => null]);
            $telegram->sendMessage($chatId, 'الشيك المطلوب صورته ما عاد موجود.');

            return;
        }

        $largest = collect($photos)->sortByDesc('file_size')->first();
        $bytes = $telegram->downloadFile($largest['file_id']);

        if (! $bytes) {
            $telegram->sendMessage($chatId, 'تعذّر تحميل الصورة، حاول مرة ثانية.');

            return;
        }

        $slot = $link->pending_check_slot ?? 1;
        $tmpPath = tempnam(sys_get_temp_dir(), 'chk');
        file_put_contents($tmpPath, $bytes);
        $uploadedFile = new UploadedFile($tmpPath, 'check.jpg', 'image/jpeg', null, true);

        $checkService->attachImage($check, $uploadedFile, $slot);
        $link->update(['pending_check_id' => null, 'pending_check_slot' => null]);
        @unlink($tmpPath);

        $side = $slot === 2 ? 'الظهر' : 'الوجه';
        $telegram->sendMessage($chatId, "تم حفظ صورة {$side} للشيك رقم {$check->check_number} بنجاح، شكراً! 📎", $keyboard);
    }

    // ---------------------------------------------------------------
    // Patient (patient_id-linked) self-service
    // ---------------------------------------------------------------

    protected function patientKeyboard(): array
    {
        return [
            [self::BTN_MY_APPOINTMENTS, self::BTN_BOOK],
            [self::BTN_MY_ACCOUNT, self::BTN_PRESCRIPTIONS],
            [self::BTN_TEETH],
        ];
    }

    protected function handlePatientMessage(int $chatId, string $text, TelegramLink $link, TelegramService $telegram): void
    {
        $patient = $link->patient;
        if (! $patient) {
            return;
        }

        $keyboard = $this->patientKeyboard();

        if ($text === self::BTN_CANCEL_BOOKING && $link->booking_step) {
            $link->update(['booking_step' => null, 'booking_doctor_id' => null, 'booking_date' => null]);
            $telegram->sendMessage($chatId, 'تم إلغاء الحجز.', $keyboard);

            return;
        }

        // A booking conversation in progress takes priority over everything
        // else — the next message is the reply to whatever step we're on.
        if ($link->booking_step) {
            $this->handleBookingStep($chatId, $text, $link, $telegram, app(DoctorSlotService::class));

            return;
        }

        if ($text === self::BTN_MY_APPOINTMENTS || $text === '/start') {
            $upcoming = Appointment::where('patient_id', $patient->id)
                ->where('starts_at', '>=', now())
                ->whereIn('status', ['scheduled', 'confirmed'])
                ->orderBy('starts_at')
                ->get();

            if ($upcoming->isEmpty()) {
                $telegram->sendMessage($chatId, 'ما في مواعيد قادمة إلك حالياً.', $keyboard);
            } else {
                $lines = $upcoming->map(fn (Appointment $a) => sprintf('%s — %s', $this->localTime($a->starts_at, 'd/m/Y H:i'), $a->doctor_name ?? 'بدون طبيب محدد'));
                $telegram->sendMessage($chatId, "مواعيدك القادمة:\n".$lines->implode("\n"), $keyboard);
            }

            return;
        }

        if ($text === self::BTN_BOOK) {
            $this->startBooking($chatId, $link, $telegram);

            return;
        }

        if ($text === self::BTN_MY_ACCOUNT) {
            $balance = $patient->transactions()->sum('amount_ils');
            $telegram->sendMessage($chatId, sprintf('رصيدك الحالي: %s ₪', number_format((float) $balance, 2)), $keyboard);

            return;
        }

        if ($text === self::BTN_PRESCRIPTIONS) {
            $prescriptions = Prescription::where('patient_id', $patient->id)->orderByDesc('created_at')->take(5)->get();

            if ($prescriptions->isEmpty()) {
                $telegram->sendMessage($chatId, 'ما في وصفات مسجّلة إلك.', $keyboard);

                return;
            }

            $lines = $prescriptions->map(fn (Prescription $p) => sprintf("%s\n%s", $this->localTime($p->created_at, 'd/m/Y'), $p->medications));
            $telegram->sendMessage($chatId, "آخر وصفاتك:\n\n".$lines->implode("\n\n"), $keyboard);

            return;
        }

        if ($text === self::BTN_TEETH) {
            $this->sendTeethSummary($chatId, $patient, $telegram, $keyboard);

            return;
        }

        if ($text === '' || str_starts_with($text, '/')) {
            $telegram->sendMessage($chatId, 'اختر من الأزرار تحت 👇', $keyboard);

            return;
        }

        // Anything else is a free-text message to the clinic — filed as a
        // note on the patient's profile so staff sees it right where they
        // already look, tagged with the author so an owner exists for the
        // required notes.user_id column.
        $author = User::role('owner')->first();
        if ($author) {
            Note::create([
                'notable_type' => Patient::class,
                'notable_id' => $patient->id,
                'user_id' => $author->id,
                'body' => "[من تيليغرام] {$text}",
            ]);
        }

        $telegram->sendMessage($chatId, 'وصلت رسالتك للعيادة، رح يتم التواصل معك.', $keyboard);
    }

    // ---------------------------------------------------------------
    // Doctor (doctor_id-linked) — doctors registered by name only,
    // without a User login. Scoped to their own schedule only.
    // ---------------------------------------------------------------

    protected function handleDoctorMessage(int $chatId, string $text, ?array $photos, TelegramLink $link, TelegramService $telegram, CheckService $checkService): void
    {
        $doctor = $link->doctor;
        if (! $doctor) {
            return;
        }

        $keyboard = [[self::BTN_TODAY, self::BTN_WEEK], [self::BTN_MY_COMMISSION, self::BTN_SEARCH_PATIENT]];

        if ($photos && $link->pending_check_id) {
            $this->handleCheckPhotoReply($chatId, $photos, $link, $telegram, $checkService, $keyboard);

            return;
        }

        if ($text === self::BTN_TODAY || $text === '/start') {
            $this->handleDoctorAppointments($chatId, $doctor, $link, $telegram, 0, $keyboard);

            return;
        }

        if ($text === self::BTN_WEEK) {
            $this->handleDoctorAppointments($chatId, $doctor, $link, $telegram, 6, $keyboard);

            return;
        }

        if ($text === self::BTN_MY_COMMISSION) {
            $this->handleCommissionStatement($chatId, $doctor, $telegram, $keyboard);

            return;
        }

        if ($text === self::BTN_SEARCH_PATIENT) {
            $link->update(['pending_intent' => 'doctor_patient_search']);
            $telegram->sendMessage($chatId, 'اكتبلي اسم المريض للبحث.', []);

            return;
        }

        if ($link->pending_intent === 'doctor_patient_search' && $text !== '') {
            $this->searchPatientsForDoctor($chatId, $text, $link, $telegram, $keyboard);

            return;
        }

        // A patient-name button tapped from a results list (either the last
        // appointments list or a name search) — pending_intent tells us
        // which, and for the appointments case, which date range it covered.
        if ($link->pending_intent && str_starts_with($link->pending_intent, 'doctor_patient_pick:') && $text !== '') {
            $daysAhead = (int) substr($link->pending_intent, strlen('doctor_patient_pick:'));
            $this->sendPatientDetailToDoctor($chatId, $doctor, $text, $daysAhead, $telegram, $keyboard);

            return;
        }

        if ($link->pending_intent === 'doctor_patient_search_pick' && $text !== '') {
            $this->sendAnyPatientDetailToDoctor($chatId, $text, $telegram, $keyboard);

            return;
        }

        $telegram->sendMessage($chatId, 'اختر من الأزرار تحت 👇', $keyboard);
    }

    /**
     * Current-month totals only (no line-by-line breakdown — too long for
     * a chat message) — same figures as the web commission-statement page:
     * commission earned + flat salary (if the contract includes one) minus
     * whatever's already been paid out this month.
     */
    protected function handleCommissionStatement(int $chatId, Doctor $doctor, TelegramService $telegram, array $keyboard): void
    {
        $month = Carbon::now()->startOfMonth();

        $commissionTotal = (float) DoctorTransaction::where('doctor_id', $doctor->id)
            ->where('type', 'commission')
            ->whereDate('period_month', $month->toDateString())
            ->sum('amount_ils');

        $salaryDue = in_array($doctor->contract_type, ['salary', 'salary_commission'], true)
            ? (float) ($doctor->monthly_salary ?? 0)
            : 0.0;

        $paidTotal = (float) DoctorTransaction::where('doctor_id', $doctor->id)
            ->where('type', 'settlement')
            ->whereDate('period_month', $month->toDateString())
            ->sum('amount_ils');

        $totalDue = $commissionTotal + $salaryDue;
        $remaining = $totalDue - $paidTotal;

        $lines = ["كشف حساب شهر {$month->translatedFormat('F Y')}:"];
        if ($commissionTotal > 0) {
            $lines[] = sprintf('العمولات: %s ₪', number_format($commissionTotal, 2));
        }
        if ($salaryDue > 0) {
            $lines[] = sprintf('الراتب الثابت: %s ₪', number_format($salaryDue, 2));
        }
        $lines[] = sprintf('الإجمالي المستحق: %s ₪', number_format($totalDue, 2));
        $lines[] = sprintf('المدفوع لغاية هلق: %s ₪', number_format($paidTotal, 2));
        $lines[] = sprintf('%s: %s ₪', $remaining >= 0 ? 'المتبقي إلك' : 'مدفوع لك زيادة', number_format(abs($remaining), 2));

        $telegram->sendMessage($chatId, implode("\n", $lines), $keyboard);
    }

    /**
     * Clinic-wide patient name search for a doctor away from the clinic —
     * not scoped to their own appointments, same normalized-Arabic search
     * used everywhere else in the app (أحمد also finds أحمد/إحمد/etc).
     */
    protected function searchPatientsForDoctor(int $chatId, string $text, TelegramLink $link, TelegramService $telegram, array $keyboard): void
    {
        $term = Arabic::normalize(trim($text));
        $nameExpr = Arabic::normalizeSql('full_name');

        $patients = Patient::whereRaw("{$nameExpr} ilike ?", ["%{$term}%"])
            ->orderBy('full_name')
            ->limit(10)
            ->get();

        if ($patients->isEmpty()) {
            $telegram->sendMessage($chatId, 'ما لقيت مريض بهالاسم.', $keyboard);

            return;
        }

        $link->update(['pending_intent' => 'doctor_patient_search_pick']);
        $rows = $patients->map(fn (Patient $p) => [$p->full_name])->values()->all();

        $telegram->sendMessage($chatId, 'اضغط اسم المريض لتشوف تفاصيله 👇', array_merge($rows, $keyboard));
    }

    /**
     * Same detail view as sendPatientDetailToDoctor, but for a name-search
     * result — matches any patient by name (not just today's/this week's
     * appointments), so it can't reuse that method's appointment-scoped query.
     */
    protected function sendAnyPatientDetailToDoctor(int $chatId, string $patientName, TelegramService $telegram, array $keyboard): void
    {
        $patient = Patient::where('full_name', $patientName)->first();

        if (! $patient) {
            $telegram->sendMessage($chatId, 'اختر اسم المريض من الأزرار تحت.');

            return;
        }

        $this->sendPatientQuickDetail($chatId, $patient, $telegram, $keyboard);
    }

    /** Phone, medical alerts, and tooth-chart summary — everything worth checking before a patient sits in the chair, without leaving the chat. */
    protected function sendPatientQuickDetail(int $chatId, Patient $patient, TelegramService $telegram, array $keyboard): void
    {
        $lines = [$patient->full_name];
        $lines[] = $patient->phone ? "📞 {$patient->phone}" : '📞 بدون رقم مسجّل';

        $alerts = $patient->medical_alerts ?? [];
        if (! empty($alerts)) {
            $lines[] = '⚠️ تنبيهات طبية: '.implode('، ', $alerts);
        }

        $telegram->sendMessage($chatId, implode("\n", $lines));
        $this->sendTeethSummary($chatId, $patient, $telegram, $keyboard, forSelf: false);
    }

    protected function handleDoctorAppointments(int $chatId, Doctor $doctor, TelegramLink $link, TelegramService $telegram, int $daysAhead, array $keyboard): void
    {
        $appointments = Appointment::with('patient:id,full_name')
            ->where('doctor_id', $doctor->id)
            ->whereBetween('starts_at', [Carbon::today(), Carbon::today()->addDays($daysAhead)->endOfDay()])
            ->whereIn('status', ['scheduled', 'confirmed'])
            ->orderBy('starts_at')
            ->get();

        if ($appointments->isEmpty()) {
            $link->update(['pending_intent' => null]);
            $telegram->sendMessage($chatId, 'لا يوجد مواعيد بهذا النطاق — يومك فاضي. 🟢', $keyboard);

            return;
        }

        $lines = $appointments->map(fn (Appointment $a) => sprintf('%s — %s', $this->localTime($a->starts_at, 'd/m H:i'), $a->patient?->full_name));

        // A button per patient below the list — tapping one shows their
        // phone, medical alerts, and tooth-chart summary, so the doctor can
        // check a patient's file before they walk in without leaving the chat.
        $link->update(['pending_intent' => "doctor_patient_pick:{$daysAhead}"]);
        $patientRows = $appointments->pluck('patient.full_name')->filter()->unique()->map(fn ($name) => [$name])->values()->all();

        $telegram->sendMessage(
            $chatId,
            "مواعيدك:\n".$lines->implode("\n")."\n\nاضغط اسم أي مريض تحت لتشوف تفاصيله 👇",
            array_merge($patientRows, $keyboard),
        );
    }

    /**
     * Matches the tapped name against the same appointment list (by date
     * range) the doctor was just shown, and sends back the patient's phone,
     * medical alerts, and tooth-chart summary — everything worth checking
     * before they sit in the chair, without leaving the chat.
     */
    protected function sendPatientDetailToDoctor(int $chatId, Doctor $doctor, string $patientName, int $daysAhead, TelegramService $telegram, array $keyboard): void
    {
        $appointment = Appointment::with('patient')
            ->where('doctor_id', $doctor->id)
            ->whereBetween('starts_at', [Carbon::today(), Carbon::today()->addDays($daysAhead)->endOfDay()])
            ->whereIn('status', ['scheduled', 'confirmed'])
            ->whereHas('patient', fn ($q) => $q->where('full_name', $patientName))
            ->orderBy('starts_at')
            ->first();

        $patient = $appointment?->patient;
        if (! $patient) {
            $telegram->sendMessage($chatId, 'اختر اسم المريض من الأزرار تحت.');

            return;
        }

        $this->sendPatientQuickDetail($chatId, $patient, $telegram, $keyboard);
    }

    // ---------------------------------------------------------------
    // حجز موعد — multi-step self-service booking for linked patients,
    // each step offered as buttons instead of typed numbers/commands.
    // ---------------------------------------------------------------

    protected function startBooking(int $chatId, TelegramLink $link, TelegramService $telegram): void
    {
        $doctors = Doctor::where('is_active', true)->orderBy('full_name')->get();

        if ($doctors->isEmpty()) {
            $telegram->sendMessage($chatId, 'ما في أطباء متاحين للحجز حالياً، تواصل مع العيادة مباشرة.', $this->patientKeyboard());

            return;
        }

        $link->update(['booking_step' => 'doctor']);

        $rows = $doctors->map(fn (Doctor $d) => ["د. {$d->full_name}"])->values()->all();
        $rows[] = [self::BTN_CANCEL_BOOKING];

        $telegram->sendMessage($chatId, 'اختر الطبيب:', $rows);
    }

    protected function handleBookingStep(int $chatId, string $text, TelegramLink $link, TelegramService $telegram, DoctorSlotService $slotService): void
    {
        $patient = $link->patient;

        if ($link->booking_step === 'doctor') {
            $doctor = Doctor::where('is_active', true)->get()->first(fn (Doctor $d) => "د. {$d->full_name}" === trim($text));

            if (! $doctor) {
                $telegram->sendMessage($chatId, 'اختر الطبيب من الأزرار تحت.');

                return;
            }

            $link->update(['booking_doctor_id' => $doctor->id, 'booking_step' => 'date']);
            $telegram->sendMessage(
                $chatId,
                'اختيار ممتاز! هلق اختر التاريخ، أو اكتبه بصيغة يوم/شهر/سنة.',
                [[self::BTN_TODAY_SHORT, self::BTN_TOMORROW], [self::BTN_CANCEL_BOOKING]],
            );

            return;
        }

        if ($link->booking_step === 'date') {
            $date = $this->parseSpokenDate(trim($text));

            if (! $date) {
                $telegram->sendMessage($chatId, 'ما قدرت أفهم التاريخ. اختر من الأزرار، أو اكتب بصيغة يوم/شهر/سنة.');

                return;
            }

            $doctor = $link->bookingDoctor;
            $slots = $slotService->availableSlots($doctor, $patient->branch_id, $date->toDateString());

            if (empty($slots)) {
                $telegram->sendMessage($chatId, 'ما في مواعيد فاضية عند هالطبيب بهالتاريخ. جرب تاريخ تاني.');

                return;
            }

            $link->update(['booking_date' => $date->toDateString(), 'booking_step' => 'slot']);

            $rows = collect($slots)->map(fn ($s) => [$s['starts_at_display']])->values()->all();
            $rows[] = [self::BTN_CANCEL_BOOKING];

            $telegram->sendMessage($chatId, "الأوقات الفاضية يوم {$date->format('d/m/Y')}:", $rows);

            return;
        }

        if ($link->booking_step === 'slot') {
            $doctor = $link->bookingDoctor;
            $slots = $slotService->availableSlots($doctor, $patient->branch_id, $link->booking_date->toDateString());
            $slot = collect($slots)->first(fn ($s) => $s['starts_at_display'] === trim($text));

            if (! $slot) {
                $telegram->sendMessage($chatId, 'اختر الوقت من الأزرار تحت.');

                return;
            }

            $appointment = Appointment::create([
                'branch_id' => $patient->branch_id,
                'patient_id' => $patient->id,
                'doctor_id' => $doctor->id,
                'starts_at' => $slot['starts_at'],
                'ends_at' => $slot['ends_at'],
                'status' => 'scheduled',
                'created_via' => 'bot',
            ]);

            $link->update(['booking_step' => null, 'booking_doctor_id' => null, 'booking_date' => null]);

            $telegram->sendMessage(
                $chatId,
                sprintf("تم حجز موعدك بنجاح! ✅\nد. %s — %s", $doctor->full_name, $this->localTime($slot['starts_at'], 'd/m/Y H:i')),
                $this->patientKeyboard(),
            );

            $notifyEnabled = \App\Models\Setting::where('key', 'notify_new_appointment_enabled')->value('value');
            $doctorLink = $notifyEnabled !== false ? TelegramLink::activeForDoctor($doctor) : null;
            if ($doctorLink) {
                $telegram->sendMessage(
                    (int) $doctorLink->telegram_chat_id,
                    sprintf("📅 موعد جديد (حجز ذاتي)!\n%s — %s", $this->localTime($appointment->starts_at, 'd/m/Y H:i'), $patient->full_name),
                );
            }
        }
    }

    /** Accepts "اليوم", "بكرا", or dd/mm/yyyy — enough for a chat-based date field without a real picker. */
    protected function parseSpokenDate(string $text): ?Carbon
    {
        if ($text === 'اليوم') {
            return Carbon::today();
        }
        if ($text === 'بكرا' || $text === 'بكره') {
            return Carbon::tomorrow();
        }
        if (preg_match('#^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$#', $text, $m)) {
            try {
                return Carbon::createFromDate((int) $m[3], (int) $m[2], (int) $m[1])->startOfDay();
            } catch (\Throwable) {
                return null;
            }
        }

        return null;
    }

    // ---------------------------------------------------------------
    // وضع أسناني — compact text summary of a patient's chart
    // ---------------------------------------------------------------

    /** $forSelf: true when the patient is checking their own chart ("أسنانك"), false when a doctor is checking a patient's chart from elsewhere ("أسنان <name>"). */
    protected function sendTeethSummary(int $chatId, Patient $patient, TelegramService $telegram, array $keyboard, bool $forSelf = true): void
    {
        $findings = ToothFinding::where('patient_id', $patient->id)
            ->whereNotNull('service_id')
            ->with('service:id,name')
            ->get();

        if ($findings->isEmpty()) {
            $telegram->sendMessage($chatId, $forSelf ? 'ما في سجل أسنان محفوظ إلك بعد.' : "ما في سجل أسنان محفوظ لـ{$patient->full_name} بعد.", $keyboard);

            return;
        }

        // Latest finding per tooth wins, same convention as the chart itself.
        $latestByTooth = $findings->sortByDesc('id')->unique('tooth_number');

        $done = $latestByTooth->where('status', 'done');
        $inProgress = $latestByTooth->whereIn('status', ['planned', 'in_progress']);

        $summarize = fn ($rows) => $rows->groupBy(fn ($f) => $f->service?->name ?? 'غير محدد')
            ->map(fn ($group, $name) => sprintf('%s: %d سن', $name, $group->count()))
            ->implode("\n");

        $lines = [];
        if ($done->isNotEmpty()) {
            $lines[] = "✅ منجز:\n".$summarize($done);
        }
        if ($inProgress->isNotEmpty()) {
            $lines[] = "🕓 مخطط/قيد التنفيذ:\n".$summarize($inProgress);
        }

        $header = $forSelf ? 'وضع أسنانك' : "وضع أسنان {$patient->full_name}";
        $telegram->sendMessage($chatId, "{$header}:\n\n".implode("\n\n", $lines), $keyboard);
    }
}
