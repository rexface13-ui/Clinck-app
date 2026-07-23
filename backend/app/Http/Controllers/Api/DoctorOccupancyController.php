<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Appointment;
use App\Models\Doctor;
use Illuminate\Http\Request;
use Carbon\CarbonPeriod;
use Illuminate\Support\Carbon;

class DoctorOccupancyController extends Controller
{
    /**
     * Per-day occupancy for a doctor across a whole month — feeds the
     * dashboard's monthly calendar. A day's color is how full it is
     * relative to that doctor's own configured working hours for that
     * weekday, not some clinic-wide guess: 'closed' (no availability
     * configured for that weekday), 'empty' (0 booked), 'some' (booked but
     * under 80% of available minutes), 'full' (80%+ — effectively can't
     * take another walk-in slot).
     */
    public function index(Request $request, Doctor $doctor)
    {
        $this->authorize('view', $doctor);

        $data = $request->validate([
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'month' => ['required', 'integer', 'min:1', 'max:12'],
            'branch_id' => ['sometimes', 'integer', 'exists:branches,id'],
        ]);

        $timezone = config('dentaflow.display_timezone');
        $monthStart = Carbon::create($data['year'], $data['month'], 1, 0, 0, 0, $timezone)->startOfDay();
        $monthEnd = $monthStart->clone()->endOfMonth()->endOfDay();

        $availabilityQuery = $doctor->availability();
        if (! empty($data['branch_id'])) {
            $availabilityQuery->where('branch_id', $data['branch_id']);
        }
        $availability = $availabilityQuery->get();

        // Available minutes per weekday (0 = Sunday ... 6 = Saturday), summed
        // across every window that weekday (a doctor can have more than one
        // block per day, e.g. morning + evening).
        $minutesByWeekday = [];
        foreach ($availability as $window) {
            [$startH, $startM] = explode(':', substr($window->start_time, 0, 5));
            [$endH, $endM] = explode(':', substr($window->end_time, 0, 5));
            $minutes = (((int) $endH * 60) + (int) $endM) - (((int) $startH * 60) + (int) $startM);
            $minutesByWeekday[$window->weekday] = ($minutesByWeekday[$window->weekday] ?? 0) + max(0, $minutes);
        }

        $appointments = Appointment::where('doctor_id', $doctor->id)
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->where('starts_at', '<', $monthEnd->clone()->timezone('UTC'))
            ->where('ends_at', '>', $monthStart->clone()->timezone('UTC'))
            ->get(['starts_at', 'ends_at']);

        $days = [];

        foreach (CarbonPeriod::create($monthStart, $monthEnd) as $day) {
            $weekday = $day->dayOfWeek;
            $availableMinutes = $minutesByWeekday[$weekday] ?? 0;

            $dayStartUtc = $day->clone()->startOfDay()->timezone('UTC');
            $dayEndUtc = $day->clone()->endOfDay()->timezone('UTC');

            $dayAppointments = $appointments->filter(
                fn ($a) => Carbon::parse($a->starts_at)->lt($dayEndUtc) && Carbon::parse($a->ends_at)->gt($dayStartUtc)
            );

            $bookedMinutes = 0;
            foreach ($dayAppointments as $a) {
                $bookedMinutes += Carbon::parse($a->starts_at)->diffInMinutes(Carbon::parse($a->ends_at));
            }

            if ($availableMinutes <= 0) {
                $status = $dayAppointments->count() > 0 ? 'some' : 'closed';
            } elseif ($bookedMinutes <= 0) {
                $status = 'empty';
            } elseif ($bookedMinutes / $availableMinutes >= 0.8) {
                $status = 'full';
            } else {
                $status = 'some';
            }

            $days[] = [
                'date' => $day->format('Y-m-d'),
                'status' => $status,
                'appointments_count' => $dayAppointments->count(),
                'available_minutes' => $availableMinutes,
                'booked_minutes' => $bookedMinutes,
            ];
        }

        return ['days' => $days];
    }
}
