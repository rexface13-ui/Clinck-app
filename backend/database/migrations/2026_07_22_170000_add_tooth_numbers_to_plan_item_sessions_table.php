<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plan_item_sessions', function (Blueprint $table) {
            // Which teeth (a subset of the item's overall tooth_numbers pool)
            // were actually worked on in THIS session — null means "all of
            // the item's teeth", which keeps every existing single-visit flow
            // (walk-ins, same-day plans) behaving exactly as before.
            $table->json('tooth_numbers')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('plan_item_sessions', function (Blueprint $table) {
            $table->dropColumn('tooth_numbers');
        });
    }
};
