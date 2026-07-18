<?php

use App\Support\DateFormatter;

if (! function_exists('display_date')) {
    function display_date(DateTimeInterface|string|null $value): ?string
    {
        return DateFormatter::date($value);
    }
}

if (! function_exists('display_datetime')) {
    function display_datetime(DateTimeInterface|string|null $value): ?string
    {
        return DateFormatter::dateTime($value);
    }
}
