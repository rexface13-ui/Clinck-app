<?php

namespace Database\Seeders;

use App\Models\Branch;
use App\Models\Cashbox;
use App\Models\Clinic;
use App\Models\ExpenseCategory;
use App\Models\IncomeCategory;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

/**
 * Seeds clinic #1 — the single local clinic this deployment runs for.
 * Owner login is printed to the console; there is no other way to get in
 * on a fresh database.
 */
class ClinicSeeder extends Seeder
{
    protected array $permissions = [
        'users.view', 'users.manage',
        'doctors.view', 'doctors.manage',
        'patients.view', 'patients.manage',
        'dental_chart.manage',
        'services.view', 'services.manage',
        'appointments.view', 'appointments.manage',
        'settings.manage',
        'treatment_plans.view', 'treatment_plans.manage',
        'billing.view', 'billing.manage',
        'cash.view', 'cash.manage',
        'commissions.view',
        'suppliers.view', 'suppliers.manage',
        'purchasing.view', 'purchasing.manage',
        'checks.view', 'checks.manage',
        'inventory.view', 'inventory.manage',
        'reports.view',
        'medications.view', 'medications.manage',
    ];

    protected array $rolePermissions = [
        'owner' => '*',
        'doctor' => [
            'patients.view', 'dental_chart.manage',
            'appointments.view', 'appointments.manage',
            'services.view', 'treatment_plans.view',
            'medications.view', 'medications.manage',
        ],
        'secretary' => [
            'patients.view', 'patients.manage',
            'appointments.view', 'appointments.manage',
            'doctors.view', 'services.view',
            'treatment_plans.view', 'treatment_plans.manage',
            'billing.view', 'billing.manage',
            'purchasing.view', 'purchasing.manage',
            'checks.view', 'checks.manage',
            'medications.view',
        ],
        'accountant' => [
            'patients.view', 'doctors.view',
            'services.view', 'appointments.view',
            'treatment_plans.view',
            'billing.view', 'billing.manage',
            'cash.view', 'cash.manage',
            'commissions.view',
            'suppliers.view', 'suppliers.manage',
            'checks.view', 'checks.manage',
            'inventory.view',
            'reports.view',
        ],
    ];

    protected array $expenseCategories = ['إيجار', 'رواتب', 'مستلزمات طبية', 'صيانة', 'أخرى'];

    protected array $incomeCategories = ['أخرى'];

    public function run(): void
    {
        DB::transaction(function (): void {
            $clinic = Clinic::firstOrCreate(
                ['slug' => 'main'],
                ['name' => 'العيادة الرئيسية', 'is_active' => true],
            );

            $branch = Branch::withoutGlobalScopes()->firstOrCreate(
                ['clinic_id' => $clinic->id, 'is_main' => true],
                ['name' => 'الفرع الرئيسي', 'is_active' => true],
            );

            foreach ($this->permissions as $key) {
                Permission::findOrCreate($key, 'web');
            }

            foreach ($this->rolePermissions as $roleName => $perms) {
                $role = Role::findOrCreate($roleName, 'web');
                $role->syncPermissions($perms === '*' ? $this->permissions : $perms);
            }

            $owner = User::withoutGlobalScopes()->firstOrCreate(
                ['email' => 'owner@dentaflow.local'],
                [
                    'clinic_id' => $clinic->id,
                    'name' => 'مالك العيادة',
                    'username' => 'owner',
                    'password' => 'password',
                    'is_active' => true,
                ],
            );

            if (! $owner->hasRole('owner')) {
                $owner->assignRole('owner');
            }

            $owner->branches()->syncWithoutDetaching([$branch->id]);

            $defaults = [
                'commission_basis' => 'completed',
                'base_currency' => 'ILS',
                'tooth_numbering' => 'fdi',
                'inventory_enabled' => false,
                'insurance_enabled' => false,
                // Shekels per one unit of each foreign currency. Starts empty
                // so nothing is silently converted at a made-up rate — the
                // clinic fills these in from the settings page.
                'exchange_rates' => (object) [],
            ];

            foreach ($defaults as $key => $value) {
                Setting::withoutGlobalScopes()->updateOrCreate(
                    ['clinic_id' => $clinic->id, 'key' => $key],
                    ['value' => $value],
                );
            }

            Cashbox::withoutGlobalScopes()->firstOrCreate(
                ['branch_id' => $branch->id, 'currency' => 'ILS'],
                ['clinic_id' => $clinic->id, 'name' => 'صندوق شيكل', 'balance' => 0],
            );

            foreach ($this->expenseCategories as $name) {
                ExpenseCategory::withoutGlobalScopes()->firstOrCreate(
                    ['clinic_id' => $clinic->id, 'name' => $name],
                );
            }

            foreach ($this->incomeCategories as $name) {
                IncomeCategory::withoutGlobalScopes()->firstOrCreate(
                    ['clinic_id' => $clinic->id, 'name' => $name],
                );
            }
        });

        $this->command?->info('Owner login: owner@dentaflow.local / password');
    }
}
