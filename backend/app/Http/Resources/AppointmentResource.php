<?php

namespace App\Http\Resources;

use App\Models\Appointment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AppointmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $hasPendingWork = $this->relationLoaded('workItems') && $this->workItems->contains(fn ($w) => $w->status === 'in_progress');

        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'patient_id' => $this->patient_id,
            'patient_name' => $this->whenLoaded('patient', fn () => $this->patient?->full_name),
            'doctor_id' => $this->doctor_id,
            'doctor_name' => $this->whenLoaded('doctor', fn () => $this->doctor?->full_name),
            'starts_at' => $this->starts_at?->toIso8601String(),
            'ends_at' => $this->ends_at?->toIso8601String(),
            'starts_at_display' => display_datetime($this->starts_at),
            'status' => $this->status,
            'created_via' => $this->created_via,
            'notes' => $this->notes,
            'work_items' => $this->whenLoaded('workItems', fn () => $this->workItems->map(fn ($w) => [
                'id' => $w->id,
                'service_name' => $w->service?->name,
                'service_color' => $w->service?->color,
                'doctor_name' => $w->doctor?->full_name,
                'status' => $w->status,
                'teeth' => $w->relationLoaded('teeth') ? $w->teeth->pluck('tooth_number')->sort()->values() : [],
                // What's left on this specific work item — one row per
                // tooth+step not yet marked complete, so the appointment
                // detail view can say exactly what's still pending, not
                // just "in progress".
                'pending' => $w->relationLoaded('steps')
                    ? $w->steps->flatMap(fn ($step) => $step->relationLoaded('toothSteps')
                        ? $step->toothSteps->where('completed_at', null)->map(fn ($ts) => [
                            'tooth_number' => (int) $ts->tooth_number,
                            'step_title' => $step->title,
                        ])
                        : collect())->values()
                    : [],
            ])),
            'has_pending_work' => $hasPendingWork,
            // Only worth the extra query when this appointment actually
            // left something unfinished — tells the owner/secretary either
            // "here's the follow-up already booked" or "nothing's booked
            // yet" so they know to schedule one.
            'follow_up_appointment' => $hasPendingWork ? (function () {
                $next = Appointment::where('patient_id', $this->patient_id)
                    ->whereIn('status', ['scheduled', 'confirmed'])
                    ->where('starts_at', '>', $this->starts_at)
                    ->orderBy('starts_at')
                    ->first();

                return $next ? ['id' => $next->id, 'starts_at_display' => display_datetime($next->starts_at)] : null;
            })() : null,
        ];
    }
}
