<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tooth_findings', function (Blueprint $table) {
            $table->foreignId('plan_item_session_id')->nullable()->after('service_id')
                ->constrained('plan_item_sessions')->nullOnDelete();
            $table->boolean('performed_externally')->default(false)->after('marks_missing');
        });
    }

    public function down(): void
    {
        Schema::table('tooth_findings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('plan_item_session_id');
            $table->dropColumn('performed_externally');
        });
    }
};
