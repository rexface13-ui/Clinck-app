<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\CheckModel;
use App\Models\LabCase;
use App\Models\Setting;
use App\Models\TelegramLink;
use App\Services\TelegramService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class TelegramSendReminders extends Command
{
    protected $signature = 'telegram:send-reminders';

    protected $description = 'Send Telegram reminders for upcoming appointments and checks nearing their due date';

    public function handle(TelegramService $telegram): int
    {
        if (config('telegram.bot_token') === '') {
            $this->warn('TELEGRAM_BOT_TOKEN غير معرّف — تخطي إرسال التذكيرات.');

            return self::SUCCESS;
        }

        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        $enabled = Setting::whereIn('key', ['reminder_appointments_enabled', 'reminder_checks_enabled', 'reminder_lab_enabled'])
            ->get()
            ->keyBy('key');

        $isEnabled = fn (string $key) => ! $enabled->has($key) || $enabled->get($key)->value !== false;

        if ($isEnabled('reminder_appointments_enabled')) {
            $this->sendAppointmentReminders($telegram);
        }
        if ($isEnabled('reminder_checks_enabled')) {
            $this->sendCheckReminders($telegram);
        }
        if ($isEnabled('reminder_lab_enabled')) {
            $this->sendLabCaseReminders($telegram);
        }

        return self::SUCCESS;
    }

    protected function sendLabCaseReminders(TelegramService $telegram): void
    {
        $cases = LabCase::with(['patient:id,full_name', 'supplier:id,name'])
            ->where('status', '!=', 'received')
            ->where('expected_return_date', '<=', Carbon::today())
            ->get();

        if ($cases->isEmpty()) {
            return;
        }

        $lines = $cases->map(fn (LabCase $c) => sprintf(
            '%s — %s (مخبر: %s، متوقع: %s)',
            $c->patient?->full_name,
            $c->description,
            $c->supplier?->name,
            $c->expected_return_date->format('d/m/Y'),
        ));

        $recipients = TelegramLink::with('user')
            ->whereNotNull('linked_at')
            ->get()
            ->filter(fn (TelegramLink $link) => $link->user?->hasAnyRole(['owner', 'secretary']));

        foreach ($recipients as $link) {
            $telegram->sendMessage($link->telegram_chat_id, "تذكير: حالات مخبر وصل تاريخها المتوقع — تأكد وصلت ولا لسا:\n".$lines->implode("\n"));
        }
    }

    protected function sendAppointmentReminders(TelegramService $telegram): void
    {
        $appointments = Appointment::with(['patient:id,full_name', 'doctor'])
            ->whereBetween('starts_at', [now(), now()->addDay()])
            ->whereIn('status', ['scheduled', 'confirmed'])
            ->orderBy('starts_at')
            ->get()
            ->groupBy('doctor_id');

        foreach ($appointments as $doctorAppointments) {
            $doctor = $doctorAppointments->first()->doctor;
            $link = TelegramLink::activeForDoctor($doctor);

            if (! $link) {
                continue;
            }

            $lines = $doctorAppointments->map(fn (Appointment $a) => sprintf(
                '%s — %s',
                $a->starts_at->format('d/m/Y H:i'),
                $a->patient?->full_name,
            ));

            $telegram->sendMessage($link->telegram_chat_id, "تذكير: مواعيدك خلال 24 ساعة القادمة:\n".$lines->implode("\n"));
        }
    }

    protected function sendCheckReminders(TelegramService $telegram): void
    {
        $checks = CheckModel::where('status', 'in_wallet')
            ->whereBetween('due_date', [Carbon::today(), Carbon::today()->addDays(7)])
            ->get();

        if ($checks->isEmpty()) {
            return;
        }

        $lines = $checks->map(fn (CheckModel $c) => sprintf(
            '%s — %s %s (استحقاق %s)',
            $c->check_number,
            number_format((float) $c->amount, 2),
            $c->currency,
            $c->due_date->format('d/m/Y'),
        ));

        $recipients = TelegramLink::with('user')
            ->whereNotNull('linked_at')
            ->get()
            ->filter(fn (TelegramLink $link) => $link->user?->hasAnyRole(['owner', 'accountant']));

        foreach ($recipients as $link) {
            $telegram->sendMessage($link->telegram_chat_id, "تذكير: شيكات مستحقة خلال 7 أيام:\n".$lines->implode("\n"));
        }
    }
}
