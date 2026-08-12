<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('patients', function (Blueprint $table) {
            // Replaces birth_date in the UI — clinic staff usually only
            // know the patient's age, not an exact birth date. birth_date
            // stays in the schema (untouched, still nullable) for any
            // patient that already has one; is_child now prefers age when
            // it's set and only falls back to birth_date otherwise.
            $table->unsignedTinyInteger('age')->nullable()->after('birth_date');
        });
    }

    public function down(): void
    {
        Schema::table('patients', function (Blueprint $table) {
            $table->dropColumn('age');
        });
    }
};
