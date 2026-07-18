<?php

return [

    /*
    |--------------------------------------------------------------------------
    | SaaS Mode
    |--------------------------------------------------------------------------
    |
    | When false (local, single-clinic deployment) feature() always returns
    | true and CurrentClinic always resolves to local_clinic_id. Phase 5
    | flips this to true so feature() reads from plan_features per clinic.
    |
    */

    'saas_mode' => (bool) env('DENTAFLOW_SAAS_MODE', false),

    /*
    |--------------------------------------------------------------------------
    | Local Clinic ID
    |--------------------------------------------------------------------------
    |
    | The clinic_id used everywhere by BelongsToClinic/CurrentClinic while
    | saas_mode is false. Seeded as clinic #1.
    |
    */

    'local_clinic_id' => (int) env('DENTAFLOW_LOCAL_CLINIC_ID', 1),

    /*
    |--------------------------------------------------------------------------
    | Display Timezone
    |--------------------------------------------------------------------------
    |
    | All timestamps are stored in UTC (timestamptz). DateFormatter converts
    | to this timezone for display only.
    |
    */

    'display_timezone' => env('DISPLAY_TIMEZONE', 'Asia/Hebron'),

    /*
    |--------------------------------------------------------------------------
    | Feature Keys
    |--------------------------------------------------------------------------
    |
    | Every splittable feature, registered with Pennant by
    | FeatureServiceProvider and reported to the frontend via /api/bootstrap.
    | Add a key here first before gating anything on it.
    |
    */

    'feature_keys' => [
        'bot',
        'checks',
        'purchasing',
        'insurance',
        'multi_branch',
        'max_users',
        'max_patients',
        'storage',
    ],

    /*
    |--------------------------------------------------------------------------
    | Database Backup / Restore
    |--------------------------------------------------------------------------
    |
    | Paths to the PostgreSQL client binaries used by backup:create /
    | backup:restore. Custom-format dumps (pg_dump -Fc) so pg_restore can do
    | a clean, transactional restore.
    |
    */

    'pg_dump_path' => env('PG_DUMP_PATH', 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe'),
    'pg_restore_path' => env('PG_RESTORE_PATH', 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe'),

];
