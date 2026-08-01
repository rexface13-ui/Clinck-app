<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Lets a tooth note optionally record which work session it was written
 * during, so the notebook can show "recorded during: <service> — <date>"
 * instead of just a timestamp.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notes', function (Blueprint $table) {
            $table->foreignId('work_item_id')->nullable()->after('tooth_number')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('notes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('work_item_id');
        });
    }
};
