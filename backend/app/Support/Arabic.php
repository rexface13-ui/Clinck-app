<?php

namespace App\Support;

class Arabic
{
    /**
     * Chars Arabic speakers routinely mix up when typing (أ/إ/آ/ا, ة/ه,
     * ى/ي, ؤ/و, ئ/ي) collapsed to one canonical form, so search doesn't
     * require the exact variant the data was originally typed with.
     */
    public const MAP = [
        'أ' => 'ا',
        'إ' => 'ا',
        'آ' => 'ا',
        'ٱ' => 'ا',
        'ة' => 'ه',
        'ى' => 'ي',
        'ؤ' => 'و',
        'ئ' => 'ي',
    ];

    public static function normalize(string $text): string
    {
        return strtr($text, self::MAP);
    }

    /**
     * A SQL expression (Postgres TRANSLATE) that applies the same
     * normalization to a column, so `WHERE normalizeSql('col') ILIKE ?`
     * matches regardless of which variant is stored vs typed.
     */
    public static function normalizeSql(string $column): string
    {
        $from = implode('', array_keys(self::MAP));
        $to = implode('', array_values(self::MAP));

        return "translate({$column}, '{$from}', '{$to}')";
    }
}
