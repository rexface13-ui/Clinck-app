<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Tracks what a chat is currently expected to reply with, now that the
     * bot is button-driven instead of slash-command-driven — e.g. "we just
     * asked an unlinked chat to type their name" or "we just asked a staff
     * member to type a patient code to search". A plain text reply only
     * makes sense in light of what button/prompt came right before it.
     */
    public function up(): void
    {
        Schema::table('telegram_links', function (Blueprint $table) {
            $table->string('pending_intent')->nullable()->after('booking_date');
        });
    }

    public function down(): void
    {
        Schema::table('telegram_links', function (Blueprint $table) {
            $table->dropColumn('pending_intent');
        });
    }
};
