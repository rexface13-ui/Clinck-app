<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Doctor;
use App\Models\Setting;
use Illuminate\Support\Carbon;

class DoctorSlotService
{
    /**
     * Free appointment slots for a doctor on a given date: doctor_availability
     * for that weekday, chopped into $duration-minute slots, minus whatever
     * is already booked. Shared by DoctorSlotController (web) and the
     * Telegram booking flow so both use the exact same math.
     */
    public function availableSlots(Doctor $doctor, int $branchId, string $date, ?int $duration = null): array
    {
        $timezone = config('dentaflow.display_timezone');
        $defaultDuration = (int) (Setting::where('key', 'default_appointment_duration')->first()?->value ?? 30);
        $duration = $duration ?? $defaultDuration;
        $dateCarbon = Carbon::parse($date, $timezone)->startOfDay();
        $weekday = $dateCarbon->dayOfWeek;

        $availability = $doctor->availability()
            ->where('branch_id', $branchId)
            ->where('weekday', $weekday)
            ->get();

        $dayStartUtc = $dateCarbon->clone()->timezone('UTC');
        $dayEndUtc = $dateCarbon->clone()->endOfDay()->timezone('UTC');

        $booked = Appointment::where('doctor_id', $doctor->id)
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->where('starts_at', '<', $dayEndUtc)
            ->where('ends_at', '>', $dayStartUtc)
            ->get(['starts_at', 'ends_at']);

        $slots = [];

        foreach ($availability as $window) {
            [$startH, $startM] = explode(':', substr($window->start_time, 0, 5));
            [$endH, $endM] = explode(':', substr($window->end_time, 0, 5));

            $cursor = $dateCarbon->clone()->setTime((int) $startH, (int) $startM);
            $windowEnd = $dateCarbon->clone()->setTime((int) $endH, (int) $endM);

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
                        'starts_at' => $slotStartUtc,
                        'ends_at' => $slotEndUtc,
                        'starts_at_display' => $slotStart->format('H:i'),
                        'ends_at_display' => $slotEnd->format('H:i'),
                    ];
                }

                $cursor->addMinutes($duration);
            }
        }

        return $slots;
    }
}
