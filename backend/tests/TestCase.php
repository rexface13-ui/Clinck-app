<?php

namespace Tests;

use App\Models\Branch;
use App\Models\Cashbox;
use App\Models\Clinic;
use App\Models\Doctor;
use App\Models\Patient;
use App\Models\Service;
use App\Models\ServiceStep;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemStep;
use App\Models\WorkItemTooth;
use App\Models\WorkItemToothStep;
use App\Support\Tenancy\CurrentClinic;
use Database\Seeders\ClinicSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected Branch $branch;

    protected Cashbox $cashbox;

    protected User $owner;

    /**
     * Every test starts where a real deployment does: the seeded clinic, its
     * main branch, its shekel cashbox and the owner account. Tests then add
     * only the patients/doctors/work their scenario is actually about.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(ClinicSeeder::class);

        // Postgres sequences don't roll back with the transaction RefreshDatabase
        // wraps each test in, so the re-seeded clinic gets a fresh id every test
        // while the tenancy default stays pinned to local_clinic_id. Point the
        // current clinic at whatever was actually seeded, or every scoped query
        // from the second test onwards silently returns nothing.
        CurrentClinic::set(Clinic::withoutGlobalScopes()->where('slug', 'main')->firstOrFail()->id);

        $this->branch = Branch::withoutGlobalScopes()->where('is_main', true)->firstOrFail();
        $this->cashbox = Cashbox::where('currency', 'ILS')->firstOrFail();
        $this->owner = User::withoutGlobalScopes()->where('username', 'owner')->firstOrFail();
    }

    protected function makePatient(string $name = 'مريض تجريبي'): Patient
    {
        return Patient::create([
            'branch_id' => $this->branch->id,
            'code' => Patient::nextCode(),
            'full_name' => $name,
            'gender' => 'male',
            'phone' => '0599000000',
        ]);
    }

    protected function makeDoctor(string $name = 'د. تجريبي', float $commissionPercent = 20): Doctor
    {
        return Doctor::create([
            'full_name' => $name,
            'contract_type' => 'commission',
            'default_commission_percent' => $commissionPercent,
            'is_active' => true,
        ]);
    }

    /** A one-step service priced per tooth — the shape most clinic work takes. */
    protected function makeService(string $name = 'حشوة', float $price = 100, bool $pricePerTooth = true): Service
    {
        $service = Service::create([
            'name' => $name,
            'default_price' => $price,
            'default_currency' => 'ILS',
            'default_sessions' => 1,
            'is_active' => true,
            'price_per_tooth' => $pricePerTooth,
            'color' => '#3b82f6',
        ]);

        ServiceStep::create([
            'service_id' => $service->id,
            'title' => 'الخطوة الأولى',
            'price' => $price,
            'sort_order' => 1,
        ]);

        return $service;
    }

    /**
     * Builds a work item (a session) on the given teeth, mirroring what
     * WorkItemService::create() produces, so billing tests have something
     * real to check out.
     */
    protected function makeWorkItem(Patient $patient, Doctor $doctor, Service $service, array $teeth = [11]): WorkItem
    {
        $serviceStep = $service->steps()->firstOrFail();

        $workItem = WorkItem::create([
            'patient_id' => $patient->id,
            'doctor_id' => $doctor->id,
            'service_id' => $service->id,
            'price_per_tooth' => (bool) $service->price_per_tooth,
            'status' => 'in_progress',
        ]);

        $step = WorkItemStep::create([
            'work_item_id' => $workItem->id,
            'service_step_id' => $serviceStep->id,
            'title' => $serviceStep->title,
            'price' => $serviceStep->price,
            'sort_order' => 1,
        ]);

        foreach ($teeth as $tooth) {
            WorkItemTooth::create(['work_item_id' => $workItem->id, 'tooth_number' => $tooth]);

            WorkItemToothStep::create([
                'work_item_id' => $workItem->id,
                'tooth_number' => $tooth,
                'work_item_step_id' => $step->id,
            ]);
        }

        return $workItem->fresh(['teeth', 'steps.toothSteps']);
    }

    /**
     * Marks the session's steps done, which is what makes them billable —
     * checkout() only charges for tooth-steps the doctor has actually ticked
     * off and that aren't on an invoice yet.
     */
    protected function completeWork(WorkItem $workItem): WorkItem
    {
        WorkItemToothStep::where('work_item_id', $workItem->id)
            ->whereNull('completed_at')
            ->update(['completed_at' => now()]);

        return $workItem->fresh(['teeth', 'steps.toothSteps']);
    }
}
