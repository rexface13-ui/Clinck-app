<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Note\StoreNoteRequest;
use App\Http\Resources\NoteResource;
use App\Models\Note;
use App\Models\Patient;

class PatientNoteController extends Controller
{
    public function store(StoreNoteRequest $request, Patient $patient)
    {
        $this->authorize('update', $patient);

        $note = $patient->notes()->create([
            'user_id' => $request->user()->id,
            'body' => $request->validated('body'),
        ]);

        return new NoteResource($note->load('user'));
    }

    public function destroy(Patient $patient, Note $note)
    {
        $this->authorize('update', $patient);

        // notable_type is stored as the morph-map alias ('patient'), not the
        // FQCN — see the identical fix in PatientAttachmentController.
        abort_unless($note->notable_type === $patient->getMorphClass() && $note->notable_id === $patient->id, 404);

        $note->delete();

        return response()->noContent();
    }
}
