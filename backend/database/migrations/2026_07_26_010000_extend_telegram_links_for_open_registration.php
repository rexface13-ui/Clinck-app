<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Opens telegram_links up to chats that started cold (no staff account
     * yet) — /start now asks for a name+phone and stores them here pending
     * classification by the owner, instead of requiring a pre-existing
     * User to generate a /link code first. user_id-based links (existing
     * staff flow) keep working exactly as before.
     */
    public function up(): void
    {
        // Raw SQL: user_id was created NOT NULL with a FK, and doctrine/dbal
        // isn't installed so ->nullable()->change() isn't available — same
        // workaround already used elsewhere in this codebase (see
        // 2026_07_25_020000_make_service_category_nullable.php).
        DB::statement('ALTER TABLE telegram_links DROP CONSTRAINT telegram_links_user_id_foreign');
        DB::statement('ALTER TABLE telegram_links ALTER COLUMN user_id DROP NOT NULL');
        DB::statement('ALTER TABLE telegram_links ADD CONSTRAINT telegram_links_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');

        Schema::table('telegram_links', function (Blueprint $table) {
            $table->foreignId('patient_id')->nullable()->after('user_id')->constrained()->nullOnDelete();
            $table->string('registered_name')->nullable()->after('patient_id');
            $table->string('registered_phone')->nullable()->after('registered_name');
            $table->foreignId('pending_check_id')->nullable()->after('registered_phone')->constrained('checks')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('telegram_links', function (Blueprint $table) {
            $table->dropConstrainedForeignId('patient_id');
            $table->dropConstrainedForeignId('pending_check_id');
            $table->dropColumn(['registered_name', 'registered_phone']);
        });

        DB::statement('ALTER TABLE telegram_links DROP CONSTRAINT telegram_links_user_id_foreign');
        DB::statement('ALTER TABLE telegram_links ALTER COLUMN user_id SET NOT NULL');
        DB::statement('ALTER TABLE telegram_links ADD CONSTRAINT telegram_links_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
    }
};
