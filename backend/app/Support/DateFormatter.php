<?php

namespace App\Support;

use Carbon\Carbon;
use Carbon\CarbonInterface;
use DateTimeInterface;

/**
 * The single place dates get converted from storage (UTC, timestamptz) to
 * display form. Never format a date ad-hoc elsewhere — route it through
 * here so every screen and every export agrees on dd/mm/yyyy in the
 * clinic's display timezone.
 */
class DateFormatter
{
    public static function date(DateTimeInterface|string|null $value): ?string
    {
        return self::format($value, 'd/m/Y');
    }

    public static function dateTime(DateTimeInterface|string|null $value): ?string
    {
        return self::format($value, 'd/m/Y H:i');
    }

    public static function format(DateTimeInterface|string|null $value, string $format): ?string
    {
        if ($value === null) {
            return null;
        }

        $carbon = $value instanceof CarbonInterface
            ? $value->clone()
            : Carbon::parse($value);

        return $carbon->timezone(config('dentaflow.display_timezone'))->format($format);
    }
}
