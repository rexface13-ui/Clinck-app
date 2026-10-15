<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/**
 * Turns "the day the user says this really happened" into the exact instant a
 * payment or session should be stamped with.
 *
 * Picking a past day by hand only gives a calendar date, never a time of day.
 * Stamping midnight would land in the wrong day once converted between the
 * clinic's timezone and UTC (the exact bug that shifted late-night records
 * across reports), so a past day is pinned to noon local time — safely inside
 * the same calendar day in either timezone. Today keeps the real current time,
 * and a record whose day isn't actually changing keeps the exact instant it
 * already had, so re-saving an edit form never nudges its time.
 */
class RecordDate
{
    public static function resolve(?string $date, ?Carbon $existing = null): Carbon
    {
        $timezone = config('dentaflow.display_timezone');

        if ($date === null || trim($date) === '') {
            return $existing ? $existing->copy() : Carbon::now();
        }

        // '!' zeroes the time fields, so $picked is local midnight of that day.
        $picked = Carbon::createFromFormat('!Y-m-d', trim($date), $timezone);
        abort_if($picked === false, 422, 'التاريخ مش صحيح.');

        $today = Carbon::now($timezone);
        abort_if($picked->gt($today->copy()->startOfDay()), 422, 'ما فيك تسجّل تاريخ بالمستقبل.');

        if ($existing && $existing->copy()->setTimezone($timezone)->isSameDay($picked)) {
            return $existing->copy();
        }

        if ($picked->isSameDay($today)) {
            return Carbon::now();
        }

        return $picked->setTime(12, 0)->setTimezone(config('app.timezone'));
    }

    /** The record's calendar day as the clinic sees it ("Y-m-d"), for pre-filling a date picker. */
    public static function localIso(mixed $value): ?string
    {
        if (! $value) {
            return null;
        }

        return Carbon::parse($value)->setTimezone(config('dentaflow.display_timezone'))->format('Y-m-d');
    }
}
