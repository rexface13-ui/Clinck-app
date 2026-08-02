<?php

use App\Http\Controllers\Api\AllergyController;
use App\Http\Controllers\Api\AppointmentController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\BranchServicePriceController;
use App\Http\Controllers\Api\CashboxController;
use App\Http\Controllers\Api\CheckController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DebtController;
use App\Http\Controllers\Api\DoctorAvailabilityController;
use App\Http\Controllers\Api\DoctorCommissionController;
use App\Http\Controllers\Api\DoctorController;
use App\Http\Controllers\Api\DoctorOccupancyController;
use App\Http\Controllers\Api\DoctorServiceCommissionController;
use App\Http\Controllers\Api\DoctorSlotController;
use App\Http\Controllers\Api\ExpenseController;
use App\Http\Controllers\Api\IncomeController;
use App\Http\Controllers\Api\ItemCategoryController;
use App\Http\Controllers\Api\ItemController;
use App\Http\Controllers\Api\LabCaseController;
use App\Http\Controllers\Api\MedicationController;
use App\Http\Controllers\Api\PatientAttachmentController;
use App\Http\Controllers\Api\PatientBillingController;
use App\Http\Controllers\Api\ActivityLogController;
use App\Http\Controllers\Api\PatientController;
use App\Http\Controllers\Api\PrescriptionController;
use App\Http\Controllers\Api\PatientNoteController;
use App\Http\Controllers\Api\PurchaseInvoiceController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\ServiceCategoryController;
use App\Http\Controllers\Api\SettingController;
use App\Http\Controllers\Api\ServiceController;
use App\Http\Controllers\Api\StockMovementController;
use App\Http\Controllers\Api\SupplierController;
use App\Http\Controllers\Api\TelegramLinkController;
use App\Http\Controllers\Api\TelegramRegistrationController;
use App\Http\Controllers\Api\ReportPublishController;
use App\Http\Controllers\Api\ToothChartController;
use App\Http\Controllers\Api\WorkItemController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\BootstrapController;
use Illuminate\Support\Facades\Route;

// Unauthenticated on purpose — the login page needs the clinic's name/logo
// before anyone's signed in, so it can't wait behind auth:sanctum.
Route::get('/branding', function () {
    return \App\Models\Setting::whereIn('key', ['clinic_name', 'clinic_logo'])->pluck('value', 'key');
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/bootstrap', BootstrapController::class);

    Route::get('dashboard/summary', [DashboardController::class, 'summary']);
    Route::get('invoices', [DashboardController::class, 'invoices']);

    Route::get('debts/patients', [DebtController::class, 'patients']);

    Route::get('/branches', [BranchController::class, 'index']);
    Route::get('/roles', [RoleController::class, 'index']);

    Route::apiResource('users', UserController::class);

    Route::apiResource('doctors', DoctorController::class);
    Route::delete('doctors/{doctor}/force-delete', [DoctorController::class, 'forceDestroy']);
    Route::post('doctors/{doctor}/availability', [DoctorAvailabilityController::class, 'store']);
    Route::delete('doctors/{doctor}/availability/{availability}', [DoctorAvailabilityController::class, 'destroy']);
    Route::post('doctors/{doctor}/commissions', [DoctorServiceCommissionController::class, 'store']);
    Route::delete('doctors/{doctor}/commissions/{commission}', [DoctorServiceCommissionController::class, 'destroy']);
    Route::get('doctors/{doctor}/slots', [DoctorSlotController::class, 'index']);
    Route::get('doctors/{doctor}/occupancy', [DoctorOccupancyController::class, 'index']);
    Route::get('doctors-occupancy', [DoctorOccupancyController::class, 'indexAll']);
    Route::get('doctors/{doctor}/commission-statement', [DoctorCommissionController::class, 'index']);
    Route::post('doctors/{doctor}/commission-statement/pay', [DoctorCommissionController::class, 'pay']);

    Route::apiResource('service-categories', ServiceCategoryController::class)->except(['show']);
    Route::apiResource('services', ServiceController::class);
    Route::post('services/{service}/branch-prices', [BranchServicePriceController::class, 'store']);
    Route::delete('services/{service}/branch-prices/{branchPrice}', [BranchServicePriceController::class, 'destroy']);

    Route::apiResource('patients', PatientController::class);
    Route::delete('patients/{patient}/force-delete', [PatientController::class, 'forceDestroy']);
    Route::get('patients/{patient}/profile', [PatientController::class, 'profile']);
    Route::post('patients/{patient}/notes', [PatientNoteController::class, 'store']);
    Route::patch('patients/{patient}/notes/{note}', [PatientNoteController::class, 'update']);
    Route::delete('patients/{patient}/notes/{note}', [PatientNoteController::class, 'destroy']);
    Route::post('patients/{patient}/attachments', [PatientAttachmentController::class, 'store']);
    Route::delete('patients/{patient}/attachments/{attachment}', [PatientAttachmentController::class, 'destroy']);
    Route::get('attachments/{attachment}/download', [PatientAttachmentController::class, 'download'])->name('attachments.download');

    Route::get('patients/{patient}/chart', [ToothChartController::class, 'show']);
    Route::post('patients/{patient}/chart/findings', [ToothChartController::class, 'storeFinding']);
    Route::patch('patients/{patient}/chart/findings/{finding}', [ToothChartController::class, 'updateFinding']);
    Route::delete('patients/{patient}/chart/findings/{finding}', [ToothChartController::class, 'destroyFinding']);

    Route::apiResource('appointments', AppointmentController::class);
    Route::get('appointments/{appointment}/timeline', [AppointmentController::class, 'timeline']);

    Route::get('backups', [BackupController::class, 'index']);
    Route::post('backups', [BackupController::class, 'store']);
    Route::get('backups/{filename}/download', [BackupController::class, 'download']);
    Route::post('backups/restore', [BackupController::class, 'restore']);

    // Work planning (تخطيط العمل)
    Route::get('work-items', [WorkItemController::class, 'index']);
    Route::post('work-items', [WorkItemController::class, 'store']);
    Route::get('work-items/{workItem}', [WorkItemController::class, 'show']);
    Route::patch('work-items/{workItem}/tooth-steps/{toothStep}', [WorkItemController::class, 'updateToothStep']);
    Route::post('work-items/{workItem}/teeth', [WorkItemController::class, 'addTeeth']);
    Route::delete('work-items/{workItem}/teeth/{toothNumber}', [WorkItemController::class, 'removeTooth']);
    Route::patch('work-items/{workItem}/steps/{step}', [WorkItemController::class, 'updateStepPrice']);
    Route::patch('work-items/{workItem}/collected-amount', [WorkItemController::class, 'updateCollectedAmount']);
    Route::post('work-items/{workItem}/apply-to-all', [WorkItemController::class, 'applyToAll']);
    Route::post('work-items/checkout', [WorkItemController::class, 'checkout']);
    Route::post('work-items/{workItem}/schedule', [WorkItemController::class, 'schedule']);
    Route::delete('work-items/{workItem}', [WorkItemController::class, 'destroy']);
    Route::put('services/{service}/steps', [ServiceController::class, 'updateSteps']);

    // Billing / ledger
    Route::get('patients/{patient}/invoices', [PatientBillingController::class, 'invoices']);
    Route::get('invoices/{invoice}', [PatientBillingController::class, 'showInvoice']);
    Route::patch('invoices/{invoice}', [PatientBillingController::class, 'adjustInvoice']);
    Route::get('patients/{patient}/ledger', [PatientBillingController::class, 'ledger']);
    Route::post('patients/{patient}/payments', [PatientBillingController::class, 'storePayment']);
    Route::get('patients/{patient}/visits', [PatientBillingController::class, 'visits']);

    // Cash
    Route::get('cashboxes', [CashboxController::class, 'index']);
    Route::post('cashboxes', [CashboxController::class, 'store']);

    Route::get('expense-categories', [ExpenseController::class, 'categories']);
    Route::post('expense-categories', [ExpenseController::class, 'storeCategory']);
    Route::get('expenses', [ExpenseController::class, 'index']);
    Route::post('expenses', [ExpenseController::class, 'store']);
    Route::put('expenses/{expense}', [ExpenseController::class, 'update']);
    Route::delete('expenses/{expense}', [ExpenseController::class, 'destroy']);

    Route::get('income-categories', [IncomeController::class, 'categories']);
    Route::post('income-categories', [IncomeController::class, 'storeCategory']);
    Route::get('incomes', [IncomeController::class, 'index']);
    Route::post('incomes', [IncomeController::class, 'store']);
    Route::put('incomes/{income}', [IncomeController::class, 'update']);
    Route::delete('incomes/{income}', [IncomeController::class, 'destroy']);

    // Suppliers & purchasing (Phase 3)
    Route::get('suppliers', [SupplierController::class, 'index']);
    Route::post('suppliers', [SupplierController::class, 'store']);
    Route::get('suppliers/{supplier}', [SupplierController::class, 'show']);
    Route::put('suppliers/{supplier}', [SupplierController::class, 'update']);
    Route::delete('suppliers/{supplier}', [SupplierController::class, 'destroy']);
    Route::get('suppliers/{supplier}/ledger', [SupplierController::class, 'ledger']);
    Route::post('suppliers/{supplier}/pay', [SupplierController::class, 'pay']);
    Route::post('suppliers/{supplier}/discount', [SupplierController::class, 'discount']);
    Route::put('suppliers/{supplier}/transactions/{transaction}', [SupplierController::class, 'updateTransaction']);
    Route::delete('suppliers/{supplier}/transactions/{transaction}', [SupplierController::class, 'destroyTransaction']);

    Route::get('item-categories', [ItemCategoryController::class, 'index']);
    Route::post('item-categories', [ItemCategoryController::class, 'store']);
    Route::apiResource('items', ItemController::class);
    Route::get('items/{item}/price-history', [ItemController::class, 'priceHistory']);

    Route::get('purchase-invoices', [PurchaseInvoiceController::class, 'index']);
    Route::post('purchase-invoices', [PurchaseInvoiceController::class, 'store']);
    Route::get('purchase-invoices/last-price', [PurchaseInvoiceController::class, 'lastPrice']);
    Route::get('purchase-invoices/{purchaseInvoice}', [PurchaseInvoiceController::class, 'show']);
    Route::put('purchase-invoices/{purchaseInvoice}', [PurchaseInvoiceController::class, 'update']);
    Route::delete('purchase-invoices/{purchaseInvoice}', [PurchaseInvoiceController::class, 'destroy']);
    Route::post('purchase-invoices/{purchaseInvoice}/lines', [PurchaseInvoiceController::class, 'addLine']);
    Route::delete('purchase-invoices/{purchaseInvoice}/lines/{line}', [PurchaseInvoiceController::class, 'removeLine']);
    Route::post('purchase-invoices/{purchaseInvoice}/confirm', [PurchaseInvoiceController::class, 'confirm']);
    Route::post('purchase-invoices/{purchaseInvoice}/revert', [PurchaseInvoiceController::class, 'revert']);

    Route::get('lab-cases', [LabCaseController::class, 'index']);
    Route::post('lab-cases', [LabCaseController::class, 'store']);
    Route::put('lab-cases/{labCase}', [LabCaseController::class, 'update']);
    Route::delete('lab-cases/{labCase}', [LabCaseController::class, 'destroy']);

    Route::get('prescriptions', [PrescriptionController::class, 'index']);
    Route::post('prescriptions', [PrescriptionController::class, 'store']);

    Route::get('allergies', [AllergyController::class, 'index']);
    Route::post('allergies', [AllergyController::class, 'store']);
    Route::put('allergies/{allergy}', [AllergyController::class, 'update']);
    Route::delete('allergies/{allergy}', [AllergyController::class, 'destroy']);

    Route::get('medications', [MedicationController::class, 'index']);
    Route::post('medications', [MedicationController::class, 'store']);
    Route::put('medications/{medication}', [MedicationController::class, 'update']);
    Route::delete('medications/{medication}', [MedicationController::class, 'destroy']);

    Route::get('activity-logs', [ActivityLogController::class, 'index']);

    Route::get('stock-movements', [StockMovementController::class, 'index']);
    Route::post('stock-movements', [StockMovementController::class, 'store']);

    // Checks (Phase 3)
    Route::get('checks', [CheckController::class, 'index']);
    Route::post('checks', [CheckController::class, 'store']);
    Route::post('checks/{check}/endorse', [CheckController::class, 'endorse']);
    Route::post('checks/{check}/bounce', [CheckController::class, 'bounce']);
    Route::post('checks/{check}/clear', [CheckController::class, 'clear']);
    Route::get('checks/{check}/image', [CheckController::class, 'image']);
    Route::post('checks/{check}/image', [CheckController::class, 'storeImage']);
    Route::post('checks/{check}/request-image', [CheckController::class, 'requestImage']);

    // Reports
    Route::get('reports/revenue', [ReportController::class, 'revenue']);
    Route::get('reports/revenue-by-service', [ReportController::class, 'revenueByService']);
    Route::get('reports/doctor-productivity', [ReportController::class, 'doctorProductivity']);
    Route::get('reports/patients', [ReportController::class, 'patients']);
    Route::get('reports/no-show', [ReportController::class, 'noShow']);
    Route::get('reports/debts-aging', [ReportController::class, 'debtsAging']);
    Route::get('reports/collections', [ReportController::class, 'collections']);
    Route::get('reports/pending-treatments', [ReportController::class, 'pendingTreatments']);

    Route::put('settings', [SettingController::class, 'update']);
    Route::put('chart-callout-layout', [\App\Http\Controllers\Api\ToothChartController::class, 'updateCalloutLayout']);
    Route::post('system/update', [\App\Http\Controllers\Api\SystemUpdateController::class, 'update']);

    // Telegram linking (Phase 4)
    Route::get('telegram-link', [TelegramLinkController::class, 'show']);
    Route::post('telegram-link', [TelegramLinkController::class, 'store']);
    Route::delete('telegram-link', [TelegramLinkController::class, 'destroy']);

    Route::get('telegram-registrations', [TelegramRegistrationController::class, 'index']);
    Route::post('telegram-registrations/{link}/link-staff', [TelegramRegistrationController::class, 'linkStaff']);
    Route::post('telegram-registrations/{link}/link-doctor', [TelegramRegistrationController::class, 'linkDoctor']);
    Route::post('telegram-registrations/{link}/link-patient', [TelegramRegistrationController::class, 'linkPatient']);
    Route::delete('telegram-registrations/{link}', [TelegramRegistrationController::class, 'destroy']);

    Route::get('reports', [ReportPublishController::class, 'index']);
    Route::post('reports/publish', [ReportPublishController::class, 'publish']);
});
