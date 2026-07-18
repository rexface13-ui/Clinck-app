<?php

namespace App\Console\Commands;

use App\Models\Appointment;
use App\Models\CheckModel;
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

        $this->sendAppointmentReminders($telegram);
        $this->sendCheckReminders($telegram);

        return self::SUCCESS;
    }

    protected function sendAppointmentReminders(TelegramService $telegram): void
    {
        $appointments = Appointment::with(['patient:id,full_name', 'doctor.user'])
            ->whereBetween('starts_at', [now(), now()->addDay()])
            ->whereIn('status', ['scheduled', 'confirmed'])
            ->orderBy('starts_at')
            ->get()
            ->groupBy('doctor_id');

        foreach ($appointments as $doctorAppointments) {
            $doctorUser = $doctorAppointments->first()->doctor?->user;
            $link = $doctorUser ? TelegramLink::where('user_id', $doctorUser->id)->whereNotNull('linked_at')->first() : null;

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
            ->whereBetween('due_date', [Carbon::today(), Carbon::today()->addDays(3)])
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
            $telegram->sendMessage($link->telegram_chat_id, "تذكير: شيكات مستحقة خلال 3 أيام:\n".$lines->implode("\n"));
        }
    }
}
