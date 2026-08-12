<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plan_items', function (Blueprint $table) {
            // One item can now cover several teeth worked on together in one
            // visit (e.g. a whole-arch cleaning) — one price, one session,
            // not one item per tooth. tooth_number stays as the single-tooth
            // case / first tooth for anything that only reads that column.
            $table->json('tooth_numbers')->nullable()->after('tooth_number');
        });
    }

    public function down(): void
    {
        Schema::table('plan_items', function (Blueprint $table) {
            $table->dropColumn('tooth_numbers');
        });
    }
};
