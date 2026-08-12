<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Attachment\StoreAttachmentRequest;
use App\Http\Resources\AttachmentResource;
use App\Models\Attachment;
use App\Models\Patient;
use App\Models\TelegramLink;
use App\Services\TelegramService;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class PatientAttachmentController extends Controller
{
    /**
     * Takes one file or many in a single request — an x-ray series or a set of
     * before/after photos belongs to the patient as a batch, and uploading them
     * one dialog at a time is how half a set ends up missing.
     */
    public function store(StoreAttachmentRequest $request, Patient $patient)
    {
        $this->authorize('update', $patient);

        $files = $request->file('files') ?? array_filter([$request->file('file')]);
        $titles = $request->input('titles', []);

        $attachments = DB::transaction(fn () => collect($files)->values()->map(function ($file, $index) use ($patient, $request, $titles) {
            return $patient->attachments()->create([
                'disk' => 'local',
                'path' => $file->store("patients/{$patient->id}", 'local'),
                'original_name' => $file->getClientOriginalName(),
                // One title for one file, or a matching list for a batch. Blank
                // entries stay null so the file name shows through as before.
                'title' => $this->titleAt($titles, $index) ?? $request->input('title'),
                'mime_type' => $file->getClientMimeType(),
                'size_bytes' => $file->getSize(),
                'uploaded_by' => $request->user()->id,
            ]);
        }));

        return AttachmentResource::collection($attachments)->response()->setStatusCode(201);
    }

    private function titleAt(mixed $titles, int $index): ?string
    {
        if (! is_array($titles)) {
            return null;
        }

        $title = trim((string) ($titles[$index] ?? ''));

        return $title === '' ? null : $title;
    }

    /** Renaming is the whole point of the title — "IMG_5512.jpg" ages badly. */
    public function update(Request $request, Patient $patient, Attachment $attachment)
    {
        $this->authorize('update', $patient);
        $this->assertBelongsTo($attachment, $patient);

        $data = $request->validate([
            'title' => ['present', 'nullable', 'string', 'max:255'],
        ]);

        $title = trim((string) $data['title']);
        $attachment->update(['title' => $title === '' ? null : $title]);

        return new AttachmentResource($attachment->fresh());
    }

    public function destroy(Patient $patient, Attachment $attachment)
    {
        $this->authorize('update', $patient);
        $this->assertBelongsTo($attachment, $patient);

        Storage::disk($attachment->disk)->delete($attachment->path);
        $attachment->delete();

        return response()->noContent();
    }

    /**
     * Asks a linked staff member to send the next few photos straight from
     * Telegram — the same flow as a check photo, so an x-ray snapped on a phone
     * lands in the right file without anyone emailing it to themselves first.
     */
    public function requestViaTelegram(Request $request, Patient $patient, TelegramService $telegram)
    {
        $this->authorize('update', $patient);

        $data = $request->validate([
            'count' => ['required', 'integer', 'min:1', 'max:10'],
            'title' => ['nullable', 'string', 'max:255'],
        ]);

        // A link is "live" once linked_at is set — the same test the check
        // photo request uses; there is no status column.
        $link = TelegramLink::where('user_id', $request->user()->id)->whereNotNull('linked_at')->first();

        abort_unless($link, 422, 'حسابك مش مربوط بتيليغرام. اربطه أول من الإعدادات.');

        $link->update([
            'pending_patient_id' => $patient->id,
            'pending_patient_count' => $data['count'],
            'pending_patient_title' => $data['title'] ?? null,
            // A photo request for a patient and one for a check can't both be
            // outstanding on the same chat — the next photo has to have exactly
            // one place to go.
            'pending_check_id' => null,
            'pending_check_slots' => null,
        ]);

        $telegram->sendMessage(
            (int) $link->telegram_chat_id,
            sprintf('📎 ابعتلي %d صورة لملف %s.', $data['count'], $patient->full_name),
        );

        return response()->json(['message' => 'بعتنالك طلب الصور على تيليغرام.']);
    }

    public function download(Attachment $attachment): Response
    {
        $this->authorize('view', $attachment->attachable);

        return Storage::disk($attachment->disk)->download($attachment->path, $attachment->original_name);
    }

    /**
     * attachable_type is stored as the morph-map alias ('patient'), not the
     * FQCN — compare against getMorphClass() rather than Patient::class, or
     * this always 404s even for a genuinely matching attachment.
     */
    private function assertBelongsTo(Attachment $attachment, Patient $patient): void
    {
        abort_unless(
            $attachment->attachable_type === $patient->getMorphClass() && $attachment->attachable_id === $patient->id,
            404,
        );
    }
}
