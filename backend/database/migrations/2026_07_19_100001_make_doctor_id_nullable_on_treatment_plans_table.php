<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE treatment_plans ALTER COLUMN doctor_id DROP NOT NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE treatment_plans ALTER COLUMN doctor_id SET NOT NULL');
    }
};
