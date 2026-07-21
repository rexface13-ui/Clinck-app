<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Attachment\StoreAttachmentRequest;
use App\Http\Resources\AttachmentResource;
use App\Models\Attachment;
use App\Models\Patient;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;

class PatientAttachmentController extends Controller
{
    public function store(StoreAttachmentRequest $request, Patient $patient)
    {
        $this->authorize('update', $patient);

        $file = $request->file('file');
        $path = $file->store("patients/{$patient->id}", 'local');

        $attachment = $patient->attachments()->create([
            'disk' => 'local',
            'path' => $path,
            'original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getClientMimeType(),
            'size_bytes' => $file->getSize(),
            'uploaded_by' => $request->user()->id,
        ]);

        return new AttachmentResource($attachment);
    }

    public function destroy(Patient $patient, Attachment $attachment)
    {
        $this->authorize('update', $patient);

        // attachable_type is stored as the morph-map alias ('patient'), not
        // the FQCN — compare against getMorphClass() rather than Patient::class,
        // or this always 404s even for a genuinely matching attachment.
        abort_unless($attachment->attachable_type === $patient->getMorphClass() && $attachment->attachable_id === $patient->id, 404);

        Storage::disk($attachment->disk)->delete($attachment->path);
        $attachment->delete();

        return response()->noContent();
    }

    public function download(Attachment $attachment): Response
    {
        $this->authorize('view', $attachment->attachable);

        return Storage::disk($attachment->disk)->download($attachment->path, $attachment->original_name);
    }
}
