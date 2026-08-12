<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('services', function (Blueprint $table) {
            $table->string('color', 7)->default('#3b82f6')->after('price_per_tooth');
            $table->boolean('spans_teeth')->default(false)->after('color');
        });
    }

    public function down(): void
    {
        Schema::table('services', function (Blueprint $table) {
            $table->dropColumn(['color', 'spans_teeth']);
        });
    }
};
