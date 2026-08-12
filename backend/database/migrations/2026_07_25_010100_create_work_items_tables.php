<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('patient_id')->constrained()->cascadeOnDelete();
            $table->foreignId('doctor_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('service_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('appointment_id')->nullable()->constrained()->nullOnDelete();
            $table->boolean('price_per_tooth')->default(true);
            $table->string('status')->default('in_progress'); // in_progress | done | cancelled
            $table->timestamps();
        });

        Schema::create('work_item_teeth', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('work_item_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('tooth_number');
            $table->timestamps();
        });

        // Snapshot of the service's steps at the moment the work item was
        // created — later edits to the service's step definitions must not
        // retroactively change what a patient was already charged/tracked.
        Schema::create('work_item_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('work_item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('service_step_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title');
            $table->decimal('price', 10, 2)->default(0);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        // The billable/trackable atom: one step, on one tooth, within one
        // work item. field_values holds whatever the step's custom fields
        // captured for that specific tooth.
        Schema::create('work_item_tooth_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('clinic_id')->constrained()->cascadeOnDelete();
            $table->foreignId('work_item_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('tooth_number');
            $table->foreignId('work_item_step_id')->constrained()->cascadeOnDelete();
            $table->json('field_values')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->foreignId('invoice_line_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('work_item_tooth_steps');
        Schema::dropIfExists('work_item_steps');
        Schema::dropIfExists('work_item_teeth');
        Schema::dropIfExists('work_items');
    }
};
