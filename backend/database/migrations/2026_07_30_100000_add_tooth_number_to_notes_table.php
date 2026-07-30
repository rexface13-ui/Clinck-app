<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notes', function (Blueprint $table) {
            // Nullable: a patient-level note (general "notes" tab) has no
            // tooth_number, a tooth-notebook entry does — same notes table,
            // same notable (always the Patient), just an optional scope.
            $table->unsignedTinyInteger('tooth_number')->nullable()->after('notable_id');
            $table->boolean('is_important')->default(false)->after('body');
        });
    }

    public function down(): void
    {
        Schema::table('notes', function (Blueprint $table) {
            $table->dropColumn(['tooth_number', 'is_important']);
        });
    }
};
