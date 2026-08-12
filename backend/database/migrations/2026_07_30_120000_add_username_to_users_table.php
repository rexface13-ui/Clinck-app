<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('username')->nullable()->after('name');
        });

        // Backfill existing users from their email's local part so login
        // keeps working immediately after this migration runs, no manual
        // step needed.
        foreach (DB::table('users')->whereNull('username')->get(['id', 'email']) as $user) {
            $base = explode('@', $user->email)[0] ?: 'user';
            $username = $base;
            $suffix = 1;
            while (DB::table('users')->where('username', $username)->exists()) {
                $username = $base.$suffix++;
            }
            DB::table('users')->where('id', $user->id)->update(['username' => $username]);
        }

        Schema::table('users', function (Blueprint $table) {
            $table->unique('username');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('username');
        });
    }
};
