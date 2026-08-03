<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** A check often needs both sides photographed (front + back/endorsement) — image_path stays "the first/front photo", this adds a second slot. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('checks', function (Blueprint $table) {
            $table->string('image_path_2')->nullable()->after('image_path');
        });
    }

    public function down(): void
    {
        Schema::table('checks', function (Blueprint $table) {
            $table->dropColumn('image_path_2');
        });
    }
};
