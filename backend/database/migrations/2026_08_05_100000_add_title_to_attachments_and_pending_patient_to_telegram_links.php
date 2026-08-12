<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Attachments were identified only by whatever the file happened to be called —
 * "IMG_20260731_114522.jpg" tells nobody which x-ray it is. A title the clinic
 * can write and rewrite makes the file findable months later.
 *
 * The pending_patient_* pair mirrors pending_check_id: staff ask for photos
 * from the patient's file, then send them straight from Telegram, and the bot
 * knows which file they belong to and how many are still expected.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attachments', function (Blueprint $table) {
            $table->string('title')->nullable()->after('original_name');
        });

        Schema::table('telegram_links', function (Blueprint $table) {
            $table->foreignId('pending_patient_id')->nullable()->after('pending_check_slots')->constrained('patients')->nullOnDelete();
            $table->unsignedSmallInteger('pending_patient_count')->nullable()->after('pending_patient_id');
            $table->string('pending_patient_title')->nullable()->after('pending_patient_count');
        });
    }

    public function down(): void
    {
        Schema::table('attachments', function (Blueprint $table) {
            $table->dropColumn('title');
        });

        Schema::table('telegram_links', function (Blueprint $table) {
            $table->dropConstrainedForeignId('pending_patient_id');
            $table->dropColumn(['pending_patient_count', 'pending_patient_title']);
        });
    }
};
