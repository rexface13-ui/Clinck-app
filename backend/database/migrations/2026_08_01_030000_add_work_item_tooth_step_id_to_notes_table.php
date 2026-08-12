<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A tooth can have several steps under the same work item (e.g. "تخدير" then
 * "حشوة" on the same tooth in one session) — this lets a note point at the
 * exact step it was written for, so the notebook can be filtered to just
 * that step's notes when opened from within it, instead of every note ever
 * left on that tooth.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notes', function (Blueprint $table) {
            $table->foreignId('work_item_tooth_step_id')->nullable()->after('work_item_id')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('notes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('work_item_tooth_step_id');
        });
    }
};
