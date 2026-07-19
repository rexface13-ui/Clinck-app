<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tooth_findings', function (Blueprint $table) {
            $table->boolean('marks_missing')->default(false)->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('tooth_findings', function (Blueprint $table) {
            $table->dropColumn('marks_missing');
        });
    }
};
