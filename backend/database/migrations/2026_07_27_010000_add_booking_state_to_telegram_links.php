<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A patient's /book conversation spans several messages (pick doctor →
     * pick date → pick slot) — TelegramPoll is stateless between polls, so
     * the in-progress choice has to live somewhere durable between them.
     */
    public function up(): void
    {
        Schema::table('telegram_links', function (Blueprint $table) {
            $table->string('booking_step')->nullable()->after('pending_check_id');
            $table->foreignId('booking_doctor_id')->nullable()->after('booking_step')->constrained('doctors')->nullOnDelete();
            $table->date('booking_date')->nullable()->after('booking_doctor_id');
        });
    }

    public function down(): void
    {
        Schema::table('telegram_links', function (Blueprint $table) {
            $table->dropConstrainedForeignId('booking_doctor_id');
            $table->dropColumn(['booking_step', 'booking_date']);
        });
    }
};
