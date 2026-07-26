<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Doctor;
use App\Services\DoctorSlotService;
use Illuminate\Http\Request;

class DoctorSlotController extends Controller
{
    /**
     * Free appointment slots for a doctor on a given date. The actual math
     * (availability windows minus what's booked) lives in DoctorSlotService
     * so the Telegram booking flow can reuse the exact same logic.
     */
    public function index(Request $request, Doctor $doctor, DoctorSlotService $slotService)
    {
        $this->authorize('view', $doctor);

        $data = $request->validate([
            'branch_id' => ['required', 'integer', 'exists:branches,id'],
            'date' => ['required', 'date'],
            'duration' => ['sometimes', 'integer', 'min:5', 'max:240'],
        ]);

        $slots = $slotService->availableSlots($doctor, $data['branch_id'], $data['date'], $data['duration'] ?? null);

        return [
            'date' => $data['date'],
            'duration' => $data['duration'] ?? null,
            'slots' => array_map(fn ($s) => [
                'starts_at' => $s['starts_at']->toIso8601String(),
                'ends_at' => $s['ends_at']->toIso8601String(),
                'starts_at_display' => $s['starts_at_display'],
                'ends_at_display' => $s['ends_at_display'],
            ], $slots),
        ];
    }
}
