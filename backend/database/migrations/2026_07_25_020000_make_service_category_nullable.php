<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE services DROP CONSTRAINT services_service_category_id_foreign');
        DB::statement('ALTER TABLE services ALTER COLUMN service_category_id DROP NOT NULL');
        DB::statement('ALTER TABLE services ADD CONSTRAINT services_service_category_id_foreign FOREIGN KEY (service_category_id) REFERENCES service_categories (id) ON DELETE SET NULL');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE services DROP CONSTRAINT services_service_category_id_foreign');
        DB::statement('UPDATE services SET service_category_id = (SELECT id FROM service_categories ORDER BY id LIMIT 1) WHERE service_category_id IS NULL');
        DB::statement('ALTER TABLE services ALTER COLUMN service_category_id SET NOT NULL');
        DB::statement('ALTER TABLE services ADD CONSTRAINT services_service_category_id_foreign FOREIGN KEY (service_category_id) REFERENCES service_categories (id) ON DELETE CASCADE');
    }
};
