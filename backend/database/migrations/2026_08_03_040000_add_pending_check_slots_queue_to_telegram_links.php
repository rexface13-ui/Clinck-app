<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Replaces the single pending_check_slot int with a small queue string
 * (e.g. "1,2") so a single Telegram request can ask for both sides of a
 * check — the bot pops one slot per photo reply and re-prompts for the
 * next until the queue is empty.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('telegram_links', function (Blueprint $table) {
            $table->string('pending_check_slots', 10)->nullable()->after('pending_check_id');
        });
    }

    public function down(): void
    {
        Schema::table('telegram_links', function (Blueprint $table) {
            $table->dropColumn('pending_check_slots');
        });
    }
};
