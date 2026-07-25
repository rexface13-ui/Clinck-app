<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('plan_item_sessions');
        Schema::dropIfExists('plan_items');
        Schema::dropIfExists('treatment_plans');
    }

    public function down(): void
    {
        // Old treatment-plan system removed for good — not recreated on rollback.
    }
};
