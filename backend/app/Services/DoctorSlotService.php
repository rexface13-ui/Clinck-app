<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Doctor;
use App\Models\Setting;
use Illuminate\Support\Carbon;

class DoctorSlotService
{
    /**
     * Free appointment slots for a doctor on a given date: the full day
     * chopped into $duration-minute slots, minus whatever is already
     * booked. Shared by DoctorSlotController (web) and the Telegram
     * booking flow so both use the exact same math.
     *
     * Doctor working-hours windows (doctor_availability) are intentionally
     * NOT applied here — the clinic wants doctors bookable at any time, no
     * restriction. The availability rows/editor and the dashboard occupancy
     * widget (DoctorOccupancyController) are left untouched and still work
     * off that data independently; this is the only place that used to
     * treat it as a hard limit on bookable times.
     */
    public function availableSlots(Doctor $doctor, int $branchId, string $date, ?int $duration = null): array
    {
        $timezone = config('dentaflow.display_timezone');
        $defaultDuration = (int) (Setting::where('key', 'default_appointment_duration')->first()?->value ?? 30);
        $duration = $duration ?? $defaultDuration;
        $dateCarbon = Carbon::parse($date, $timezone)->startOfDay();

        $dayStartUtc = $dateCarbon->clone()->timezone('UTC');
        $dayEndUtc = $dateCarbon->clone()->endOfDay()->timezone('UTC');

        $booked = Appointment::where('doctor_id', $doctor->id)
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->where('starts_at', '<', $dayEndUtc)
            ->where('ends_at', '>', $dayStartUtc)
            ->get(['starts_at', 'ends_at']);

        $slots = [];

        $cursor = $dateCarbon->clone();
        $dayEnd = $dateCarbon->clone()->endOfDay();

        while ($cursor->clone()->addMinutes($duration)->lte($dayEnd)) {
            $slotStart = $cursor->clone();
            $slotEnd = $cursor->clone()->addMinutes($duration);

            $slotStartUtc = $slotStart->clone()->timezone('UTC');
            $slotEndUtc = $slotEnd->clone()->timezone('UTC');

            $overlaps = $booked->contains(
                fn ($appointment) => $slotStartUtc->lt($appointment->ends_at) && $slotEndUtc->gt($appointment->starts_at)
            );

            if (! $overlaps) {
                $slots[] = [
                    'starts_at' => $slotStartUtc,
                    'ends_at' => $slotEndUtc,
                    'starts_at_display' => $slotStart->format('H:i'),
                    'ends_at_display' => $slotEnd->format('H:i'),
                ];
            }

            $cursor->addMinutes($duration);
        }

        return $slots;
    }
}
