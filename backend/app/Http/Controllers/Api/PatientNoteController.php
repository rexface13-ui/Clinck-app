<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Note\StoreNoteRequest;
use App\Http\Resources\NoteResource;
use App\Models\Note;
use App\Models\Patient;
use App\Models\WorkItem;
use App\Models\WorkItemToothStep;
use Illuminate\Http\Request;

class PatientNoteController extends Controller
{
    public function store(StoreNoteRequest $request, Patient $patient)
    {
        $this->authorize('update', $patient);

        $workItemId = $request->validated('work_item_id');
        $toothStepId = $request->validated('work_item_tooth_step_id');

        if ($toothStepId) {
            // A step-scoped note only makes sense if the step really is on
            // this tooth, in a work item that belongs to this patient.
            $toothStep = WorkItemToothStep::with('workItem')->find($toothStepId);
            abort_unless(
                $toothStep && $toothStep->workItem->patient_id === $patient->id && $toothStep->tooth_number === (int) $request->validated('tooth_number'),
                422,
                'الخطوة المحددة لا تطابق هذا السن أو المريض.',
            );
            $workItemId = $toothStep->work_item_id;
        } elseif ($workItemId) {
            // Only tag the note with a session that actually belongs to this patient.
            abort_unless(WorkItem::where('id', $workItemId)->where('patient_id', $patient->id)->exists(), 422, 'الجلسة المحددة لا تخص هذا المريض.');
        }

        $note = $patient->notes()->create([
            'user_id' => $request->user()->id,
            'body' => $request->validated('body'),
            'tooth_number' => $request->validated('tooth_number'),
            'work_item_id' => $workItemId,
            'work_item_tooth_step_id' => $toothStepId,
            'is_important' => $request->boolean('is_important'),
        ]);

        return new NoteResource($note->load(['user', 'workItem.service', 'workItemToothStep.step']));
    }

    public function update(Request $request, Patient $patient, Note $note)
    {
        $this->authorize('update', $patient);
        abort_unless($note->notable_type === $patient->getMorphClass() && $note->notable_id === $patient->id, 404);

        $data = $request->validate([
            'body' => ['sometimes', 'string'],
            'is_important' => ['sometimes', 'boolean'],
        ]);

        $note->update($data);

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
