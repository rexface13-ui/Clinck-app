<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\CheckModel;
use App\Models\Note;
use App\Models\Patient;
use App\Models\Prescription;
use App\Models\Supplier;
use App\Models\TelegramLink;
use App\Models\User;
use App\Services\CheckService;
use App\Services\TelegramService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;

class TelegramPoll extends Command
{
    protected $signature = 'telegram:poll';

    protected $description = 'Long-poll the Telegram Bot API for updates and handle linking/quick commands';

    public function handle(TelegramService $telegram, CheckService $checkService): int
    {
        if ($telegram->token() === '') {
            $this->warn('التوكن غير معرّف بعد — من صفحة الإعدادات على الموقع. الأمر متوقف.');

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

        // Not yet linked at all — either a fresh /start, a staff /link code,
        // or (if a name/phone was already submitted) still pending review.
        $this->handleUnlinkedMessage($chatId, $text, $telegram);
    }

    // ---------------------------------------------------------------
    // Unlinked chats: /start, /link <code> (staff), or open registration
    // ---------------------------------------------------------------

    protected function handleUnlinkedMessage(int $chatId, string $text, TelegramService $telegram): void
    {
        if ($text === '/start') {
            $telegram->sendMessage(
                $chatId,
                "أهلاً بك! 👋\n\nإذا كنت موظف/طبيب بالعيادة وعندك كود ربط من صفحة الإعدادات، أرسل:\n/link <الكود>\n\nإذا كنت مريض، أرسل اسمك الكامل ورقم هاتفك بهذا الشكل (كل واحد بسطر):\nمحمد أحمد\n0599123456",
            );

            return;
        }

        if (str_starts_with($text, '/link')) {
            $this->handleLink($chatId, $text, $telegram);

            return;
        }

        $pending = TelegramLink::where('telegram_chat_id', $chatId)->whereNull('linked_at')->whereNotNull('registered_name')->first();
        if ($pending) {
            $telegram->sendMessage($chatId, 'طلب تسجيلك لسا قيد المراجعة من إدارة العيادة، رح نعلمك أول ما يتفعّل.');

            return;
        }

        $this->tryRegister($chatId, $text, $telegram);
    }

    protected function handleLink(int $chatId, string $text, TelegramService $telegram): void
    {
        $code = trim(substr($text, strlen('/link')));

        if ($code === '') {
            $telegram->sendMessage($chatId, 'الرجاء إرسال الكود بهذا الشكل: /link 123456');

            return;
        }

        $link = TelegramLink::where('link_code', $code)->whereNull('linked_at')->first();

        if (! $link) {
            $telegram->sendMessage($chatId, 'كود غير صحيح أو منتهي. تأكد من الكود من صفحة الإعدادات.');

            return;
        }

        $link->update(['telegram_chat_id' => $chatId, 'linked_at' => now()]);
        $telegram->sendMessage($chatId, 'تم ربط حسابك بنجاح! أرسل /appointments لعرض مواعيد اليوم.');
    }

    /**
     * Parses "الاسم\nالهاتف" from a cold /start message and files it as a
     * pending registration for the owner to classify (staff vs. patient)
     * from the Settings page — see TelegramRegistrationController.
     */
    protected function tryRegister(int $chatId, string $text, TelegramService $telegram): void
    {
        $lines = array_values(array_filter(array_map('trim', explode("\n", $text))));

        if (count($lines) < 2 || mb_strlen($lines[0]) < 2 || ! preg_match('/\d{6,}/', $lines[1])) {
            $telegram->sendMessage(
                $chatId,
                "ما قدرت أفهم الرسالة. أرسل اسمك الكامل ورقم هاتفك، كل واحد بسطر، مثلاً:\nمحمد أحمد\n0599123456",
            );

            return;
        }

        TelegramLink::updateOrCreate(
            ['telegram_chat_id' => $chatId],
            ['registered_name' => $lines[0], 'registered_phone' => $lines[1], 'linked_at' => null],
        );

        $telegram->sendMessage($chatId, 'تم استلام طلبك! رح تنراجع من إدارة العيادة وبنعلمك أول ما يتفعّل حسابك.');
    }

    // ---------------------------------------------------------------
    // Staff (user_id-linked) commands
    // ---------------------------------------------------------------

    protected function handleStaffMessage(int $chatId, string $text, ?array $photos, TelegramLink $link, TelegramService $telegram, CheckService $checkService): void
    {
        if ($photos && $link->pending_check_id) {
            $this->handleCheckPhotoReply($chatId, $photos, $link, $telegram, $checkService);

            return;
        }

        $user = $link->user;

        if ($text === '/appointments' || $text === '/today') {
            $this->handleAppointments($chatId, $link, $telegram, 0);

            return;
        }

        if ($text === '/week') {
            $this->handleAppointments($chatId, $link, $telegram, 6);

            return;
        }

        if (str_starts_with($text, '/account')) {
            $this->handleAccount($chatId, $text, $link, $telegram);

            return;
        }

        if (str_starts_with($text, '/debts')) {
            $this->handleDebtsSearch($chatId, $text, $user, $telegram);

            return;
        }

        if (str_starts_with($text, '/supplier')) {
            $this->handleSupplierSearch($chatId, $text, $user, $telegram);

            return;
        }

        $telegram->sendMessage($chatId, "الأوامر المتاحة:\n/today — مواعيد اليوم\n/week — مواعيد ٧ أيام قادمة\n/account <كود المريض> — كشف حساب مختصر\n/debts <اسم> — بحث عن مرضى عليهم دين\n/supplier <اسم> — كشف حساب مورد");
    }

    protected function handleAppointments(int $chatId, TelegramLink $link, TelegramService $telegram, int $daysAhead): void
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
            $telegram->sendMessage($chatId, 'لا يوجد مواعيد بهذا النطاق.');

            return;
        }

        $lines = $appointments->map(fn (Appointment $a) => sprintf(
            '%s — %s (د. %s)',
            $a->starts_at->format('d/m H:i'),
            $a->patient?->full_name,
            $a->doctor?->full_name,
        ));

        $telegram->sendMessage($chatId, "المواعيد:\n".$lines->implode("\n"));
    }

    protected function handleAccount(int $chatId, string $text, TelegramLink $link, TelegramService $telegram): void
    {
        $user = $link->user;
        if (! $user || ! $user->hasAnyRole(['owner', 'accountant'])) {
            $telegram->sendMessage($chatId, 'هذا الأمر متاح فقط لمالك العيادة أو المحاسب.');

            return;
        }

        $code = trim(substr($text, strlen('/account')));
        $patient = Patient::where('code', $code)->first();

        if (! $patient) {
            $telegram->sendMessage($chatId, 'ما لقيت مريض بهذا الكود. استخدم: /account P-000001');

            return;
        }

        $balance = $patient->transactions()->sum('amount_ils');
        $telegram->sendMessage($chatId, sprintf('كشف حساب %s: الرصيد الحالي %s ₪', $patient->full_name, number_format((float) $balance, 2)));
    }

    protected function handleDebtsSearch(int $chatId, string $text, ?User $user, TelegramService $telegram): void
    {
        if (! $user || ! $user->hasAnyRole(['owner', 'accountant'])) {
            $telegram->sendMessage($chatId, 'هذا الأمر متاح فقط لمالك العيادة أو المحاسب.');

            return;
        }

        $term = trim(substr($text, strlen('/debts')));

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
            $telegram->sendMessage($chatId, $term !== '' ? 'ما لقيت مرضى بهالاسم عليهم دين.' : 'ما في مرضى عليهم دين حالياً.');

            return;
        }

        $lines = $withDebt->map(fn ($row) => sprintf('%s (%s) — %s ₪', $row[0]->full_name, $row[0]->code, number_format((float) $row[1], 2)));
        $telegram->sendMessage($chatId, "المرضى الأعلى ديناً:\n".$lines->implode("\n"));
    }

    protected function handleSupplierSearch(int $chatId, string $text, ?User $user, TelegramService $telegram): void
    {
        if (! $user || ! $user->hasAnyRole(['owner', 'accountant'])) {
            $telegram->sendMessage($chatId, 'هذا الأمر متاح فقط لمالك العيادة أو المحاسب.');

            return;
        }

        $term = trim(substr($text, strlen('/supplier')));
        if ($term === '') {
            $telegram->sendMessage($chatId, 'استخدم: /supplier اسم المورد');

            return;
        }

        $suppliers = Supplier::where('name', 'like', "%{$term}%")->limit(10)->get();

        if ($suppliers->isEmpty()) {
            $telegram->sendMessage($chatId, 'ما لقيت مورد بهالاسم.');

            return;
        }

        $lines = $suppliers->map(function (Supplier $s) {
            $balance = $s->transactions()->sum('amount_ils');

            return sprintf('%s — مستحق %s ₪', $s->name, number_format((float) $balance, 2));
        });

        $telegram->sendMessage($chatId, "نتائج البحث:\n".$lines->implode("\n"));
    }

    /**
     * A staff member with an outstanding photo request (set via "طلب صورة
     * عبر تيليغرام" on a check) replies with a photo — download the
     * largest size Telegram sent, attach it to that specific check, and
     * clear the pending request.
     */
    protected function handleCheckPhotoReply(int $chatId, array $photos, TelegramLink $link, TelegramService $telegram, CheckService $checkService): void
    {
        $check = CheckModel::find($link->pending_check_id);
        if (! $check) {
            $link->update(['pending_check_id' => null]);
            $telegram->sendMessage($chatId, 'الشيك المطلوب صورته ما عاد موجود.');

            return;
        }

        $largest = collect($photos)->sortByDesc('file_size')->first();
        $bytes = $telegram->downloadFile($largest['file_id']);

        if (! $bytes) {
            $telegram->sendMessage($chatId, 'تعذّر تحميل الصورة، حاول مرة ثانية.');

            return;
        }

        $tmpPath = tempnam(sys_get_temp_dir(), 'chk');
        file_put_contents($tmpPath, $bytes);
        $uploadedFile = new UploadedFile($tmpPath, 'check.jpg', 'image/jpeg', null, true);

        $checkService->attachImage($check, $uploadedFile);
        $link->update(['pending_check_id' => null]);
        @unlink($tmpPath);

        $telegram->sendMessage($chatId, "تم حفظ صورة الشيك رقم {$check->check_number} بنجاح، شكراً! 📎");
    }

    // ---------------------------------------------------------------
    // Patient (patient_id-linked) self-service commands
    // ---------------------------------------------------------------

    protected function handlePatientMessage(int $chatId, string $text, TelegramLink $link, TelegramService $telegram): void
    {
        $patient = $link->patient;
        if (! $patient) {
            return;
        }

        if ($text === '/appointments' || $text === '/start') {
            $upcoming = Appointment::where('patient_id', $patient->id)
                ->where('starts_at', '>=', now())
                ->whereIn('status', ['scheduled', 'confirmed'])
                ->orderBy('starts_at')
                ->get();

            if ($upcoming->isEmpty()) {
                $telegram->sendMessage($chatId, 'ما في مواعيد قادمة إلك حالياً.');
            } else {
                $lines = $upcoming->map(fn (Appointment $a) => sprintf('%s — %s', $a->starts_at->format('d/m/Y H:i'), $a->doctor_name ?? 'بدون طبيب محدد'));
                $telegram->sendMessage($chatId, "مواعيدك القادمة:\n".$lines->implode("\n"));
            }

            if ($text === '/start') {
                $telegram->sendMessage($chatId, "الأوامر المتاحة:\n/appointments — مواعيدي القادمة\n/account — كشف حسابي\n/prescriptions — آخر وصفاتي\n\nولأي استفسار، اكتبلنا رسالة عادية وبتوصل للعيادة مباشرة.");
            }

            return;
        }

        if ($text === '/account') {
            $balance = $patient->transactions()->sum('amount_ils');
            $telegram->sendMessage($chatId, sprintf('رصيدك الحالي: %s ₪', number_format((float) $balance, 2)));

            return;
        }

        if ($text === '/prescriptions') {
            $prescriptions = Prescription::where('patient_id', $patient->id)->orderByDesc('created_at')->take(5)->get();

            if ($prescriptions->isEmpty()) {
                $telegram->sendMessage($chatId, 'ما في وصفات مسجّلة إلك.');

                return;
            }

            $lines = $prescriptions->map(fn (Prescription $p) => sprintf("%s\n%s", $p->created_at->format('d/m/Y'), $p->medications));
            $telegram->sendMessage($chatId, "آخر وصفاتك:\n\n".$lines->implode("\n\n"));

            return;
        }

        if ($text === '' || str_starts_with($text, '/')) {
            $telegram->sendMessage($chatId, "الأوامر المتاحة:\n/appointments — مواعيدي القادمة\n/account — كشف حسابي\n/prescriptions — آخر وصفاتي");

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

        $telegram->sendMessage($chatId, 'وصلت رسالتك للعيادة، رح يتم التواصل معك.');
    }
}
