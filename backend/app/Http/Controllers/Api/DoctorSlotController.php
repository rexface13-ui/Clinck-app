<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Doctor;
use App\Models\Setting;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class DoctorSlotController extends Controller
{
    /**
     * Free appointment slots for a doctor on a given date: doctor_availability
     * for that weekday, chopped into $duration-minute slots, minus whatever
     * is already booked. Availability times are clinic-local (display
     * timezone); everything returned is UTC for storage/booking.
     */
    public function index(Request $request, Doctor $doctor)
    {
        $this->authorize('view', $doctor);

        $data = $request->validate([
            'branch_id' => ['required', 'integer', 'exists:branches,id'],
            'date' => ['required', 'date'],
            'duration' => ['sometimes', 'integer', 'min:5', 'max:240'],
        ]);

        $timezone = config('dentaflow.display_timezone');
        $defaultDuration = (int) (Setting::where('key', 'default_appointment_duration')->first()?->value ?? 30);
        $duration = (int) ($data['duration'] ?? $defaultDuration);
        $date = Carbon::parse($data['date'], $timezone)->startOfDay();
        $weekday = $date->dayOfWeek; // 0 = Sunday ... 6 = Saturday

        $availability = $doctor->availability()
            ->where('branch_id', $data['branch_id'])
            ->where('weekday', $weekday)
            ->get();

        $dayStartUtc = $date->clone()->timezone('UTC');
        $dayEndUtc = $date->clone()->endOfDay()->timezone('UTC');

        $booked = Appointment::where('doctor_id', $doctor->id)
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->where('starts_at', '<', $dayEndUtc)
            ->where('ends_at', '>', $dayStartUtc)
            ->get(['starts_at', 'ends_at']);

        $slots = [];

        foreach ($availability as $window) {
            [$startH, $startM] = explode(':', substr($window->start_time, 0, 5));
            [$endH, $endM] = explode(':', substr($window->end_time, 0, 5));

            $cursor = $date->clone()->setTime((int) $startH, (int) $startM);
            $windowEnd = $date->clone()->setTime((int) $endH, (int) $endM);

            while ($cursor->clone()->addMinutes($duration)->lte($windowEnd)) {
                $slotStart = $cursor->clone();
                $slotEnd = $cursor->clone()->addMinutes($duration);

                $slotStartUtc = $slotStart->clone()->timezone('UTC');
                $slotEndUtc = $slotEnd->clone()->timezone('UTC');

                $overlaps = $booked->contains(
                    fn ($appointment) => $slotStartUtc->lt($appointment->ends_at) && $slotEndUtc->gt($appointment->starts_at)
                );

                if (! $overlaps) {
                    $slots[] = [
                        'starts_at' => $slotStartUtc->toIso8601String(),
                        'ends_at' => $slotEndUtc->toIso8601String(),
                        'starts_at_display' => $slotStart->format('H:i'),
                        'ends_at_display' => $slotEnd->format('H:i'),
                    ];
                }

                $cursor->addMinutes($duration);
            }
        }

        return ['date' => $data['date'], 'duration' => $duration, 'slots' => $slots];
    }
}
