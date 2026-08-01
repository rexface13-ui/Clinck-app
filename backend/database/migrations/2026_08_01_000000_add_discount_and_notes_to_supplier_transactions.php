<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_transactions', function (Blueprint $table) {
            $table->text('notes')->nullable()->after('amount_ils');
        });

        // Postgres enforces Laravel's enum() via a named CHECK constraint —
        // widening the allowed set means dropping and recreating it rather
        // than a normal column alter.
        DB::statement('ALTER TABLE supplier_transactions DROP CONSTRAINT supplier_transactions_type_check');
        DB::statement("ALTER TABLE supplier_transactions ADD CONSTRAINT supplier_transactions_type_check CHECK (type IN ('purchase', 'payment', 'check_endorsed', 'check_bounced', 'adjustment', 'discount'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE supplier_transactions DROP CONSTRAINT supplier_transactions_type_check');
        DB::statement("ALTER TABLE supplier_transactions ADD CONSTRAINT supplier_transactions_type_check CHECK (type IN ('purchase', 'payment', 'check_endorsed', 'check_bounced', 'adjustment'))");

        Schema::table('supplier_transactions', function (Blueprint $table) {
            $table->dropColumn('notes');
        });
    }
};
