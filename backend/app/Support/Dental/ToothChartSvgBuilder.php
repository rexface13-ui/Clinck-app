<?php

namespace App\Support\Dental;

/**
 * A PHP port of frontend/src/lib/dental.ts's geometry — the arch/tooth-shape
 * math there is pure trigonometry and SVG path strings with zero React or
 * Canvas dependency, so it reproduces exactly here for a static report page
 * that has no browser to render the real (react-odontogram-backed) chart in.
 * Kept deliberately in lock-step with dental.ts: if that file's numbers
 * change, this should change with it.
 */
class ToothChartSvgBuilder
{
    public const UPPER_PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];

    public const LOWER_PERMANENT = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

    public const UPPER_PRIMARY = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];

    public const LOWER_PRIMARY = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

    protected const CIRCLE_CX = 260;

    protected const CIRCLE_CY = 190;

    protected const CIRCLE_RADIUS = 148;

    protected const GAP_DEG = 7;

    public const VIEWBOX_WIDTH = 520;

    public const VIEWBOX_HEIGHT = 380;

    protected const DEFAULT_FILL = '#fff8f0';

    protected const MISSING_FILL = '#d1d5db';

    /**
     * @param  array<int, string>  $toothColors  tooth_number => hex color. A tooth not present here gets the default fill.
     * @param  array<int, bool>  $missingTeeth  tooth_number => true if marked missing (drawn flat/grayed, no crown detail).
     * @param  array<int>  $highlightTeeth  tooth numbers to ring with an accent outline (e.g. "worked on today").
     */
    public function build(array $toothColors, array $missingTeeth = [], array $highlightTeeth = [], bool $isChild = false): string
    {
        $upper = $isChild ? self::UPPER_PRIMARY : self::UPPER_PERMANENT;
        $lower = $isChild ? self::LOWER_PRIMARY : self::LOWER_PERMANENT;

        $teeth = '';
        foreach ($upper as $i => $tooth) {
            $index = $isChild ? $this->primaryCanonicalIndex($tooth) : $i;
            $teeth .= $this->drawTooth($tooth, $index, 16, ['direction' => -1], $toothColors, $missingTeeth, $highlightTeeth, $isChild);
        }
        foreach ($lower as $i => $tooth) {
            $index = $isChild ? $this->primaryCanonicalIndex($tooth) : $i;
            $teeth .= $this->drawTooth($tooth, $index, 16, ['direction' => 1], $toothColors, $missingTeeth, $highlightTeeth, $isChild);
        }

        return '<svg viewBox="0 0 '.self::VIEWBOX_WIDTH.' '.self::VIEWBOX_HEIGHT.'" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:420px;height:auto;">'.$teeth.'</svg>';
    }

    /** Mirrors dental.ts's primaryCanonicalIndex(): where a primary tooth sits within the same 16-slot canonical range a permanent arch uses. */
    protected function primaryCanonicalIndex(int $toothNumber): int
    {
        $quadrant = intdiv($toothNumber, 10);
        $position = $toothNumber % 10;
        $isFirstInList = $quadrant === 5 || $quadrant === 8;

        return $isFirstInList ? 8 - $position : 7 + $position;
    }

    protected function drawTooth(int $tooth, int $index, int $total, array $arch, array $toothColors, array $missingTeeth, array $highlightTeeth, bool $isChild): string
    {
        $direction = $arch['direction'];
        $isUpper = $direction === -1;

        $posStartDeg = $isUpper ? 180 - self::GAP_DEG : 180 + self::GAP_DEG;
        $posEndDeg = $isUpper ? self::GAP_DEG : 360 - self::GAP_DEG;

        $t = $total === 1 ? 0.5 : $index / ($total - 1);
        $posAngle = deg2rad($posStartDeg + $t * ($posEndDeg - $posStartDeg));
        $x = self::CIRCLE_CX + self::CIRCLE_RADIUS * cos($posAngle);
        $y = self::CIRCLE_CY - self::CIRCLE_RADIUS * sin($posAngle);

        $labelRadius = self::CIRCLE_RADIUS + 17;
        $labelX = self::CIRCLE_CX + $labelRadius * cos($posAngle);
        $labelY = self::CIRCLE_CY - $labelRadius * sin($posAngle);

        $angleDeg = 180 * (1 - $t);
        $rotationDeg = $direction === -1 ? $angleDeg - 90 : 90 - $angleDeg;

        $position = $tooth % 10;
        $type = $position <= 2 ? 'incisor' : ($position === 3 ? 'canine' : ($isChild ? 'molar' : ($position <= 5 ? 'premolar' : 'molar')));

        $sizes = ['incisor' => [20, 26], 'canine' => [19, 28], 'premolar' => [22, 24], 'molar' => [27, 26]];
        [$w, $h] = $sizes[$type];
        if ($isChild) {
            $w *= 0.82;
            $h *= 0.82;
        }

        $isMissing = ! empty($missingTeeth[$tooth]);
        $fill = $isMissing ? self::MISSING_FILL : ($toothColors[$tooth] ?? self::DEFAULT_FILL);
        $path = $this->crownPath($type, $w, $h);
        $highlight = in_array($tooth, $highlightTeeth, true);
        $stroke = $highlight ? '#f59e0b' : '#9ca3af';
        $strokeWidth = $highlight ? 2.5 : 1;

        return sprintf(
            '<g transform="translate(%.2f,%.2f) rotate(%.2f)"><path d="%s" fill="%s" stroke="%s" stroke-width="%s" /></g>'.
            '<text x="%.2f" y="%.2f" font-size="9" fill="#374151" text-anchor="middle">%d</text>',
            $x, $y, $rotationDeg, $path, $fill, $stroke, $strokeWidth,
            $labelX, $labelY + 3, $tooth,
        );
    }

    protected function crownPath(string $type, float $w, float $h): string
    {
        return match ($type) {
            'canine' => $this->pointedPath($w, $h),
            'premolar' => $this->scallopedPath($w, $h, 2),
            'molar' => $this->scallopedPath($w, $h, 4),
            default => $this->roundedRectPath($w, $h, min($w, $h) * 0.32),
        };
    }

    protected function roundedRectPath(float $w, float $h, float $r): string
    {
        $x = -$w / 2;
        $y = -$h / 2;

        return sprintf(
            'M%.2f,%.2f h%.2f a%.2f,%.2f 0 0 1 %.2f,%.2f v%.2f a%.2f,%.2f 0 0 1 -%.2f,%.2f h-%.2f a%.2f,%.2f 0 0 1 -%.2f,-%.2f v-%.2f a%.2f,%.2f 0 0 1 %.2f,-%.2f z',
            $x + $r, $y, $w - 2 * $r, $r, $r, $r, $r, $h - 2 * $r, $r, $r, $r, $r, $w - 2 * $r, $r, $r, $r, $r, $h - 2 * $r, $r, $r, $r, $r,
        );
    }

    protected function pointedPath(float $w, float $h): string
    {
        $x = $w / 2;
        $y = $h / 2;
        $r = $w * 0.4;

        return sprintf(
            'M0,%.2f L%.2f,%.2f a%.2f,%.2f 0 0 1 %.2f,%.2f v%.2f a%.2f,%.2f 0 0 1 -%.2f,%.2f h-%.2f a%.2f,%.2f 0 0 1 -%.2f,-%.2f v-%.2f a%.2f,%.2f 0 0 1 %.2f,-%.2f z',
            -$y, $x * 0.55, -$y + $h * 0.22, $r, $r, $r * 0.3, $r * 0.5, $h * 0.35, $r, $r, $r, $r, $w - 2 * $r, $r, $r, $r, $r, $h * 0.35, $r, $r, $r * 0.3, $r * 0.5,
        );
    }

    protected function scallopedPath(float $w, float $h, int $bumps): string
    {
        $x = $w / 2;
        $y = $h / 2;
        $rSide = min($w, $h) * 0.3;
        $bumpH = $h * 0.1;
        $step = ($w - 2 * $rSide) / $bumps;

        $top = sprintf('M%.2f,%.2f', -$x + $rSide, -$y);
        for ($i = 0; $i < $bumps; $i++) {
            $startX = -$x + $rSide + $i * $step;
            $midX = $startX + $step / 2;
            $endX = $startX + $step;
            $top .= sprintf(' Q%.2f,%.2f %.2f,%.2f', $midX, -$y - $bumpH, $endX, -$y);
        }

        return $top.sprintf(
            ' a%.2f,%.2f 0 0 1 %.2f,%.2f v%.2f a%.2f,%.2f 0 0 1 -%.2f,%.2f h-%.2f a%.2f,%.2f 0 0 1 -%.2f,-%.2f v-%.2f a%.2f,%.2f 0 0 1 %.2f,-%.2f z',
            $rSide, $rSide, $rSide, $rSide, $h - 2 * $rSide, $rSide, $rSide, $rSide, $rSide, $w - 2 * $rSide, $rSide, $rSide, $rSide, $rSide, $h - 2 * $rSide, $rSide, $rSide, $rSide, $rSide,
        );
    }
}
