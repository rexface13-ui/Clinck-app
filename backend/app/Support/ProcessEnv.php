<?php

namespace App\Support;

/**
 * Laravel's Process::env() replaces the child's environment entirely
 * rather than merging with the parent's — on Windows, a stripped
 * environment (no SystemRoot/PATH/etc.) makes native binaries like
 * pg_dump.exe fail immediately with a blank, unhelpful error. Always route
 * subprocess env through here instead of calling ->env() with a bare
 * override array.
 */
class ProcessEnv
{
    protected const INHERITED_KEYS = [
        'PATH', 'SystemRoot', 'WINDIR', 'COMSPEC',
        'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
        'PATHEXT', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH',
    ];

    public static function withOverrides(array $overrides = []): array
    {
        $env = [];

        foreach (self::INHERITED_KEYS as $key) {
            $value = getenv($key);
            if ($value !== false) {
                $env[$key] = $value;
            }
        }

        return array_merge($env, $overrides);
    }
}
