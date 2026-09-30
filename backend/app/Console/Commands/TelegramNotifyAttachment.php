<?php

namespace App\Console\Commands;

use App\Models\Attachment;
use App\Models\Doctor;
use App\Models\TelegramLink;
use App\Services\TelegramService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Pushes a just-uploaded patient attachment to one chosen doctor's Telegram —
 * launched as a detached process (see PatientAttachmentController::store) so
 * a slow/unreachable Telegram never blocks the upload response, same pattern
 * as TelegramNotifyCheckImage.
 */
class TelegramNotifyAttachment extends Command
{
    protected $signature = 'telegram:notify-attachment {attachmentId} {doctorId}';

    protected $description = 'Sends a just-added patient attachment to one doctor\'s linked Telegram chat.';

    public function handle(TelegramService $telegram): int
    {
        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        $attachment = Attachment::find((int) $this->argument('attachmentId'));
        $doctor = Doctor::find((int) $this->argument('doctorId'));
        $link = TelegramLink::activeForDoctor($doctor);

        if (! $attachment || ! $link) {
            return self::SUCCESS;
        }

        $absolutePath = Storage::disk($attachment->disk)->path($attachment->path);
        $patientName = $attachment->attachable?->full_name ?? 'مريض';
        $caption = "📎 مرفق جديد لملف {$patientName}\n".($attachment->title ?: $attachment->original_name);

        $isImage = str_starts_with((string) $attachment->mime_type, 'image/');
        $isImage
            ? $telegram->sendPhoto($link->telegram_chat_id, $absolutePath, $caption)
            : $telegram->sendDocument($link->telegram_chat_id, $absolutePath, $caption);

        return self::SUCCESS;
    }
}
