<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A general account-wide discount isn't tied to any invoice, so
 * reference_id has to be nullable — it was NOT NULL at the DB level even
 * though nothing in the app code ever validated that, so it only broke the
 * moment something actually tried to insert a null (addDiscount()).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('patient_transactions', function (Blueprint $table) {
            $table->unsignedBigInteger('reference_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('patient_transactions', function (Blueprint $table) {
            $table->unsignedBigInteger('reference_id')->nullable(false)->change();
        });
    }
};
