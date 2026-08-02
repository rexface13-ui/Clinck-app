<?php

use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

/**
 * The medications.view/manage permissions were added to ClinicSeeder after
 * some clinics were already installed — a seeder only runs on first install,
 * never again on `update.bat` (which only runs migrate), so an existing
 * clinic's owner/doctor/secretary roles never actually received these two
 * permissions even after pulling the code that ships the feature. That made
 * the "الأدوية" nav link (gated by medications.view) silently disappear for
 * every already-running install, while a brand-new install never has the
 * problem. Grants them here so a normal update picks it up automatically.
 */
return new class extends Migration
{
    public function up(): void
    {
        Permission::findOrCreate('medications.view', 'web');
        Permission::findOrCreate('medications.manage', 'web');

        $grants = [
            'owner' => ['medications.view', 'medications.manage'],
            'doctor' => ['medications.view', 'medications.manage'],
            'secretary' => ['medications.view'],
        ];

        foreach ($grants as $roleName => $permissions) {
            $role = Role::where('name', $roleName)->where('guard_name', 'web')->first();
            if ($role) {
                $role->givePermissionTo($permissions);
            }
        }
    }

    public function down(): void
    {
        // Intentionally left as a no-op — removing a permission that's now a
        // normal part of the product isn't something a rollback should do.
    }
};
