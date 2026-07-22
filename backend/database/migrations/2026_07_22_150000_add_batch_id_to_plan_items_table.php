<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plan_items', function (Blueprint $table) {
            // Items created together from one "add" action (e.g. picking several
            // teeth for the same service in one go) share a batch_id, so the UI
            // can show them as one grouped row instead of one row per tooth.
            $table->string('batch_id', 36)->nullable()->after('tooth_number');
            $table->index('batch_id');
        });
    }

    public function down(): void
    {
        Schema::table('plan_items', function (Blueprint $table) {
            $table->dropColumn('batch_id');
        });
    }
};
