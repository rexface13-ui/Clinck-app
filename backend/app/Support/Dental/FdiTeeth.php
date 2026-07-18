<?php

namespace App\Support\Dental;

/**
 * FDI (ISO 3950) tooth numbering. Permanent teeth 11-48, primary
 * (deciduous) teeth 51-85. Both sets are always valid together — mixed
 * dentition (a child with some permanent teeth already through) is common,
 * so this deliberately does not gate by patient.is_child.
 */
class FdiTeeth
{
    /**
     * @return list<int>
     */
    public static function validNumbers(): array
    {
        $numbers = [];

        foreach ([1, 2, 3, 4] as $quadrant) {
            for ($position = 1; $position <= 8; $position++) {
                $numbers[] = $quadrant * 10 + $position;
            }
        }

        foreach ([5, 6, 7, 8] as $quadrant) {
            for ($position = 1; $position <= 5; $position++) {
                $numbers[] = $quadrant * 10 + $position;
            }
        }

        return $numbers;
    }

    public static function isValid(int $toothNumber): bool
    {
        return in_array($toothNumber, self::validNumbers(), true);
    }

    public static function isPrimary(int $toothNumber): bool
    {
        return $toothNumber >= 51 && $toothNumber <= 85;
    }
}
