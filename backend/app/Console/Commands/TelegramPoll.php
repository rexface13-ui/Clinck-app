<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\Patient;
use App\Models\TelegramLink;
use App\Services\TelegramService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class TelegramPoll extends Command
{
    protected $signature = 'telegram:poll';

    protected $description = 'Long-poll the Telegram Bot API for updates and handle linking/quick commands';

    public function handle(TelegramService $telegram): int
    {
        if (config('telegram.bot_token') === '') {
            $this->warn('TELEGRAM_BOT_TOKEN غير معرّف بـ .env — الأمر متوقف. أضف التوكن وشغّله من جديد.');

            return self::SUCCESS;
        }

        $this->info('بدء استماع بوت تيليغرام (Ctrl+C للإيقاف)...');
        $offset = 0;

        while (true) {
            $updates = $telegram->getUpdates($offset);

            foreach ($updates as $update) {
                $offset = max($offset, $update['update_id'] + 1);
                $this->handleUpdate($update, $telegram);
            }

            if (empty($updates)) {
                sleep(2);
            }
        }
    }

    protected function handleUpdate(array $update, TelegramService $telegram): void
    {
        $message = $update['message'] ?? null;
        if (! $message || ! isset($message['text'], $message['chat']['id'])) {
            return;
        }

        $chatId = (int) $message['chat']['id'];
        $text = trim($message['text']);

        // Commands run outside HTTP context — bind clinic before any query.
        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        if ($text === '/start') {
            $telegram->sendMessage($chatId, "أهلاً بك! لربط حسابك أرسل:\n/link <الكود>\n\nالكود موجود بصفحة الإعدادات على موقع العيادة.");

            return;
        }

        if (str_starts_with($text, '/link')) {
            $this->handleLink($chatId, $text, $telegram);

            return;
        }

        $link = TelegramLink::where('telegram_chat_id', $chatId)->whereNotNull('linked_at')->first();

        if (! $link) {
            $telegram->sendMessage($chatId, 'حسابك غير مربوط بعد. أرسل /link <الكود> أولاً.');

            return;
        }

        if ($text === '/appointments') {
            $this->handleAppointments($chatId, $link, $telegram);

            return;
        }

        if (str_starts_with($text, '/account')) {
            $this->handleAccount($chatId, $text, $link, $telegram);

            return;
        }

        $telegram->sendMessage($chatId, "الأوامر المتاحة:\n/appointments — مواعيد اليوم\n/account <كود المريض> — كشف حساب مختصر");
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

    protected function handleAppointments(int $chatId, TelegramLink $link, TelegramService $telegram): void
    {
        $user = $link->user;
        $query = Appointment::with(['patient:id,full_name', 'doctor:id,full_name'])
            ->whereDate('starts_at', Carbon::today())
            ->orderBy('starts_at');

        if ($user?->doctor) {
            $query->where('doctor_id', $user->doctor->id);
        }

        $appointments = $query->get();

        if ($appointments->isEmpty()) {
            $telegram->sendMessage($chatId, 'لا يوجد مواعيد اليوم.');

            return;
        }

        $lines = $appointments->map(fn (Appointment $a) => sprintf(
            '%s — %s (د. %s)',
            $a->starts_at->format('H:i'),
            $a->patient?->full_name,
            $a->doctor?->full_name,
        ));

        $telegram->sendMessage($chatId, "مواعيد اليوم:\n".$lines->implode("\n"));
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
}
