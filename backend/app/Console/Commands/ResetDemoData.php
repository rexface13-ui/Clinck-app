<?php

namespace App\Console\Commands;

use App\Models\Branch;
use App\Models\Cashbox;
use App\Models\Doctor;
use App\Models\Invoice;
use App\Models\Service;
use App\Models\Supplier;
use App\Models\ExpenseCategory;
use App\Models\Patient;
use App\Models\WorkItem;
use App\Models\WorkItemStep;
use App\Models\WorkItemTooth;
use App\Models\WorkItemToothStep;
use App\Services\CashboxService;
use App\Services\CheckService;
use App\Services\PaymentService;
use App\Services\SupplierService;
use App\Services\WorkItemService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * One-off dev tool: wipes every transactional/demo table clean (keeping the
 * clinic's real setup — users, doctors, services, cashboxes, categories) and
 * rebuilds a realistic few months of clinic activity through the same real
 * service classes the app itself uses (WorkItemService::checkout,
 * PaymentService::collect, CheckService::receive/bounce, the expense
 * endpoint's own posting logic) so every side effect — commissions, cashbox
 * balances, ledger entries — is authentic, not hand-inserted rows that could
 * drift from what the real flows actually produce. Not registered for
 * production use; run manually during development only.
 */
class ResetDemoData extends Command
{
    protected $signature = 'dev:reset-demo-data';

    protected $description = 'Wipe all patient/financial demo data and rebuild a fresh realistic dataset (dev only)';

    public function handle(): int
    {
        if (! app()->environment('local')) {
            $this->error('This command only runs in the local environment.');

            return self::FAILURE;
        }

        $this->info('Wiping transactional data...');
        $this->wipe();

        $this->info('Seeding fresh demo data...');
        $this->seed();

        $this->info('Done.');

        return self::SUCCESS;
    }

    private function wipe(): void
    {
        // A pending Telegram registration can point at a patient — clear it
        // first so deleting patients below doesn't hit that foreign key.
        DB::table('telegram_links')->update(['pending_patient_id' => null]);

        // Plain DELETE in child-before-parent order — TRUNCATE would need
        // session_replication_role, which Postgres only grants to a
        // superuser, and this app's own DB role isn't necessarily one.
        foreach ([
            'check_events', 'checks', 'patient_transactions', 'payments',
            'doctor_transactions', 'cashbox_transactions', 'expenses', 'incomes',
            'purchase_invoice_lines', 'purchase_invoices', 'supplier_transactions',
            'work_item_tooth_steps', 'work_item_steps', 'work_item_teeth', 'work_items',
            'invoice_lines', 'invoices', 'tooth_findings', 'tooth_states',
            'appointments', 'notes', 'attachments', 'prescriptions', 'lab_cases',
            'patient_relatives', 'patients', 'activity_log', 'activity_logs',
            'suppliers',
        ] as $table) {
            DB::table($table)->delete();
        }

        DB::table('cashboxes')->update(['balance' => 0]);
    }

    private function seed(): void
    {
        $doctors = Doctor::where('is_active', true)->get();
        if ($doctors->isEmpty()) {
            $this->warn('No active doctors found — nothing to bill against.');

            return;
        }

        $services = Service::where('is_active', true)->get();
        if ($services->isEmpty()) {
            $this->warn('No active services found — nothing to bill.');

            return;
        }

        $branch = Branch::withoutGlobalScopes()->where('is_main', true)->firstOrFail();
        $cashbox = Cashbox::where('currency', 'ILS')->firstOrFail();
        $categories = ExpenseCategory::all();
        $workItemService = app(WorkItemService::class);
        $paymentService = app(PaymentService::class);
        $checkService = app(CheckService::class);
        $supplierService = app(SupplierService::class);
        $cashboxService = app(CashboxService::class);

        $patientNames = [
            'أحمد خالد النابلسي', 'سارة يوسف عودة', 'محمد إبراهيم دويكات', 'لينا سامي حرب',
            'يوسف عماد الأحمد', 'رنا فادي زيدان', 'خالد ناصر أبو علي', 'دانا مراد قاسم',
            'عمر باسل الشريف', 'هيا وليد نجار', 'زيد فراس حماد', 'نور طارق سلامة',
            'كريم عادل بدر', 'ريم سليم ياسين', 'طارق حسام الخطيب', 'مايا وسام فرج',
            'باسل رامي عيسى', 'جنى فادي حمدان', 'وائل سامر جرار', 'ديمة أمجد صالح',
        ];

        $supplierNames = ['مخبر الأسنان الذهبي', 'شركة اللوازم الطبية', 'مورد الأدوات الجراحية'];
        $suppliers = collect($supplierNames)->map(fn ($name) => Supplier::create(['name' => $name, 'is_active' => true]));

        $paymentMethods = ['cash', 'cash', 'cash', 'card', 'transfer'];
        $teethPool = [11, 12, 21, 22, 26, 36, 46, 14, 24];

        // Roughly 3 months of activity, oldest first, backdated via setTestNow
        // so created_at/occurred_at timestamps land where they should instead
        // of everything clustering "now".
        $start = Carbon::now()->subMonths(3)->startOfMonth();
        $sessionCount = 70;
        /** @var \Illuminate\Support\Collection<int, Patient> $existingPatients */
        $existingPatients = collect();

        for ($i = 0; $i < $sessionCount; $i++) {
            $when = $start->clone()->addDays(random_int(0, 89))->setTime(random_int(9, 17), [0, 15, 30, 45][random_int(0, 3)]);
            Carbon::setTestNow($when);

            // A returning patient roughly a third of the time (once there are
            // a few on the books) — real multi-visit history, and more than
            // one open invoice for the debts-aging/collections split to work with.
            if ($existingPatients->count() >= 5 && random_int(1, 100) <= 35) {
                $patient = $existingPatients->random();
            } else {
                $patient = Patient::create([
                    'branch_id' => $branch->id,
                    'code' => Patient::nextCode(),
                    'full_name' => $patientNames[array_rand($patientNames)] . ($existingPatients->count() >= count($patientNames) ? ' ' . random_int(2, 9) : ''),
                    'gender' => random_int(0, 1) ? 'male' : 'female',
                    'phone' => '05' . random_int(90000000, 99999999),
                ]);
                $existingPatients->push($patient);
            }

            $doctor = $doctors->random();
            $service = $services->random();
            $teeth = collect($teethPool)->random(random_int(1, 2))->values()->all();

            $workItem = WorkItem::create([
                'patient_id' => $patient->id,
                'doctor_id' => $doctor->id,
                'service_id' => $service->id,
                'price_per_tooth' => (bool) $service->price_per_tooth,
                'status' => 'in_progress',
            ]);

            foreach ($service->steps as $serviceStep) {
                $step = WorkItemStep::create([
                    'work_item_id' => $workItem->id,
                    'service_step_id' => $serviceStep->id,
                    'title' => $serviceStep->title,
                    'price' => $serviceStep->price,
                    'sort_order' => $serviceStep->sort_order,
                ]);

                foreach ($teeth as $tooth) {
                    WorkItemTooth::firstOrCreate(['work_item_id' => $workItem->id, 'tooth_number' => $tooth]);
                    WorkItemToothStep::create([
                        'work_item_id' => $workItem->id,
                        'tooth_number' => $tooth,
                        'work_item_step_id' => $step->id,
                        'completed_at' => now(),
                    ]);
                }
            }

            $result = $workItemService->checkout(patient: $patient, workItemIds: [$workItem->id], doctorId: $doctor->id);
            $invoice = Invoice::find($result['invoice_id']);
            $total = (float) $invoice->total_amount_ils;

            // Payment mix: most sessions paid in full right away by
            // cash/card/transfer; some split with a check; some left
            // partially unpaid (real debts for the debts-aging report);
            // a few checks bounce.
            $roll = random_int(1, 100);

            if ($roll <= 55) {
                $paymentService->collect(patient: $patient, cashbox: $cashbox, amount: $total, currency: 'ILS', exchangeRate: 1, method: $paymentMethods[array_rand($paymentMethods)], invoice: $invoice);
            } elseif ($roll <= 75) {
                $half = round($total / 2, 2);
                $paymentService->collect(patient: $patient, cashbox: $cashbox, amount: $half, currency: 'ILS', exchangeRate: 1, method: $paymentMethods[array_rand($paymentMethods)], invoice: $invoice);
                $check = $checkService->receive(
                    direction: 'incoming', partyType: 'patient', partyId: $patient->id,
                    checkNumber: 'CHK-' . random_int(1000, 9999), bankName: 'بنك فلسطين',
                    amount: $total - $half, currency: 'ILS', dueDate: $when->clone()->addMonth()->toDateString(), invoiceId: $invoice->id,
                );
                if (random_int(1, 100) <= 10) {
                    $checkService->bounce($check);
                }
            } elseif ($roll <= 90) {
                $partial = round($total * (random_int(30, 70) / 100), 2);
                $paymentService->collect(patient: $patient, cashbox: $cashbox, amount: $partial, currency: 'ILS', exchangeRate: 1, method: $paymentMethods[array_rand($paymentMethods)], invoice: $invoice);
            }
            // else: left fully unpaid — a real debt for debts-aging to show.
        }

        Carbon::setTestNow();

        // Expenses across every category, spread over the 3 months, posted
        // exactly the way the real "مصاريف" screen posts them (through the
        // cashbox, not a bare Expense row).
        foreach ($categories as $category) {
            for ($m = 0; $m < 3; $m++) {
                $when = $start->clone()->addMonths($m)->addDays(random_int(1, 27));
                Carbon::setTestNow($when);
                $expense = \App\Models\Expense::create([
                    'expense_category_id' => $category->id,
                    'cashbox_id' => $cashbox->id,
                    'amount' => random_int(80, 1200),
                    'currency' => 'ILS',
                    'amount_ils' => 0, // set below to match amount
                    'spent_at' => $when,
                ]);
                $expense->update(['amount_ils' => $expense->amount]);
                $cashboxService->record($cashbox, 'expense_out', 'expense', $expense->id, -(float) $expense->amount);
            }
        }
        Carbon::setTestNow();

        // A couple of supplier payments.
        foreach ($suppliers as $supplier) {
            Carbon::setTestNow($start->clone()->addDays(random_int(5, 85)));
            $supplierService->pay($supplier, $cashbox, random_int(200, 900), 'ILS', 1.0, $cashboxService);
        }
        Carbon::setTestNow();

        $this->info("Created {$sessionCount} sessions across " . Patient::count() . ' patients.');
    }
}
