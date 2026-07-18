<?php

use App\Http\Controllers\Api\AppointmentController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\BranchController;
use App\Http\Controllers\Api\BranchServicePriceController;
use App\Http\Controllers\Api\CashboxController;
use App\Http\Controllers\Api\CheckController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DoctorAvailabilityController;
use App\Http\Controllers\Api\DoctorCommissionController;
use App\Http\Controllers\Api\DoctorController;
use App\Http\Controllers\Api\DoctorServiceCommissionController;
use App\Http\Controllers\Api\DoctorSlotController;
use App\Http\Controllers\Api\ExpenseController;
use App\Http\Controllers\Api\IncomeController;
use App\Http\Controllers\Api\ItemCategoryController;
use App\Http\Controllers\Api\ItemController;
use App\Http\Controllers\Api\PatientAttachmentController;
use App\Http\Controllers\Api\PatientBillingController;
use App\Http\Controllers\Api\PatientController;
use App\Http\Controllers\Api\PatientNoteController;
use App\Http\Controllers\Api\PurchaseInvoiceController;
use App\Http\Controllers\Api\RoleController;
use App\Http\Controllers\Api\ServiceCategoryController;
use App\Http\Controllers\Api\ServiceController;
use App\Http\Controllers\Api\StockMovementController;
use App\Http\Controllers\Api\SupplierController;
use App\Http\Controllers\Api\TelegramLinkController;
use App\Http\Controllers\Api\ToothChartController;
use App\Http\Controllers\Api\TreatmentPlanController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\BootstrapController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/bootstrap', BootstrapController::class);

    Route::get('dashboard/summary', [DashboardController::class, 'summary']);

    Route::get('/branches', [BranchController::class, 'index']);
    Route::get('/roles', [RoleController::class, 'index']);

    Route::apiResource('users', UserController::class);

    Route::apiResource('doctors', DoctorController::class);
    Route::post('doctors/{doctor}/availability', [DoctorAvailabilityController::class, 'store']);
    Route::delete('doctors/{doctor}/availability/{availability}', [DoctorAvailabilityController::class, 'destroy']);
    Route::post('doctors/{doctor}/commissions', [DoctorServiceCommissionController::class, 'store']);
    Route::delete('doctors/{doctor}/commissions/{commission}', [DoctorServiceCommissionController::class, 'destroy']);
    Route::get('doctors/{doctor}/slots', [DoctorSlotController::class, 'index']);
    Route::get('doctors/{doctor}/commission-statement', [DoctorCommissionController::class, 'index']);
    Route::post('doctors/{doctor}/commission-statement/settle', [DoctorCommissionController::class, 'settle']);

    Route::apiResource('service-categories', ServiceCategoryController::class)->except(['show']);
    Route::apiResource('services', ServiceController::class);
    Route::post('services/{service}/branch-prices', [BranchServicePriceController::class, 'store']);
    Route::delete('services/{service}/branch-prices/{branchPrice}', [BranchServicePriceController::class, 'destroy']);

    Route::apiResource('patients', PatientController::class);
    Route::get('patients/{patient}/profile', [PatientController::class, 'profile']);
    Route::post('patients/{patient}/notes', [PatientNoteController::class, 'store']);
    Route::delete('patients/{patient}/notes/{note}', [PatientNoteController::class, 'destroy']);
    Route::post('patients/{patient}/attachments', [PatientAttachmentController::class, 'store']);
    Route::delete('patients/{patient}/attachments/{attachment}', [PatientAttachmentController::class, 'destroy']);
    Route::get('attachments/{attachment}/download', [PatientAttachmentController::class, 'download'])->name('attachments.download');

    Route::get('patients/{patient}/chart', [ToothChartController::class, 'show']);
    Route::post('patients/{patient}/chart/findings', [ToothChartController::class, 'storeFinding']);
    Route::delete('patients/{patient}/chart/findings/{finding}', [ToothChartController::class, 'destroyFinding']);

    Route::apiResource('appointments', AppointmentController::class);

    Route::get('backups', [BackupController::class, 'index']);
    Route::post('backups', [BackupController::class, 'store']);
    Route::get('backups/{filename}/download', [BackupController::class, 'download']);
    Route::post('backups/restore', [BackupController::class, 'restore']);

    // Treatment plans
    Route::get('treatment-plans', [TreatmentPlanController::class, 'index']);
    Route::post('treatment-plans', [TreatmentPlanController::class, 'store']);
    Route::get('treatment-plans/{treatmentPlan}', [TreatmentPlanController::class, 'show']);
    Route::delete('treatment-plans/{treatmentPlan}', [TreatmentPlanController::class, 'destroy']);
    Route::post('treatment-plans/{treatmentPlan}/items', [TreatmentPlanController::class, 'addItem']);
    Route::delete('treatment-plans/{treatmentPlan}/items/{item}', [TreatmentPlanController::class, 'removeItem']);
    Route::post('treatment-plans/{treatmentPlan}/approve', [TreatmentPlanController::class, 'approve']);
    Route::post('treatment-plans/{treatmentPlan}/schedule-sessions', [TreatmentPlanController::class, 'scheduleSessions']);

    // Billing / ledger
    Route::get('patients/{patient}/invoices', [PatientBillingController::class, 'invoices']);
    Route::get('invoices/{invoice}', [PatientBillingController::class, 'showInvoice']);
    Route::get('patients/{patient}/ledger', [PatientBillingController::class, 'ledger']);
    Route::post('patients/{patient}/payments', [PatientBillingController::class, 'storePayment']);

    // Cash
    Route::get('cashboxes', [CashboxController::class, 'index']);
    Route::post('cashboxes', [CashboxController::class, 'store']);

    Route::get('expense-categories', [ExpenseController::class, 'categories']);
    Route::post('expense-categories', [ExpenseController::class, 'storeCategory']);
    Route::get('expenses', [ExpenseController::class, 'index']);
    Route::post('expenses', [ExpenseController::class, 'store']);

    Route::get('income-categories', [IncomeController::class, 'categories']);
    Route::post('income-categories', [IncomeController::class, 'storeCategory']);
    Route::get('incomes', [IncomeController::class, 'index']);
    Route::post('incomes', [IncomeController::class, 'store']);

    // Suppliers & purchasing (Phase 3)
    Route::get('suppliers', [SupplierController::class, 'index']);
    Route::post('suppliers', [SupplierController::class, 'store']);
    Route::get('suppliers/{supplier}', [SupplierController::class, 'show']);
    Route::put('suppliers/{supplier}', [SupplierController::class, 'update']);
    Route::get('suppliers/{supplier}/ledger', [SupplierController::class, 'ledger']);
    Route::post('suppliers/{supplier}/pay', [SupplierController::class, 'pay']);

    Route::get('item-categories', [ItemCategoryController::class, 'index']);
    Route::post('item-categories', [ItemCategoryController::class, 'store']);
    Route::apiResource('items', ItemController::class)->except(['destroy']);

    Route::get('purchase-invoices', [PurchaseInvoiceController::class, 'index']);
    Route::post('purchase-invoices', [PurchaseInvoiceController::class, 'store']);
    Route::get('purchase-invoices/last-price', [PurchaseInvoiceController::class, 'lastPrice']);
    Route::get('purchase-invoices/{purchaseInvoice}', [PurchaseInvoiceController::class, 'show']);
    Route::delete('purchase-invoices/{purchaseInvoice}', [PurchaseInvoiceController::class, 'destroy']);
    Route::post('purchase-invoices/{purchaseInvoice}/lines', [PurchaseInvoiceController::class, 'addLine']);
    Route::delete('purchase-invoices/{purchaseInvoice}/lines/{line}', [PurchaseInvoiceController::class, 'removeLine']);
    Route::post('purchase-invoices/{purchaseInvoice}/confirm', [PurchaseInvoiceController::class, 'confirm']);

    Route::get('stock-movements', [StockMovementController::class, 'index']);
    Route::post('stock-movements', [StockMovementController::class, 'store']);

    // Checks (Phase 3)
    Route::get('checks', [CheckController::class, 'index']);
    Route::post('checks', [CheckController::class, 'store']);
    Route::post('checks/{check}/endorse', [CheckController::class, 'endorse']);
    Route::post('checks/{check}/bounce', [CheckController::class, 'bounce']);
    Route::post('checks/{check}/clear', [CheckController::class, 'clear']);

    // Telegram linking (Phase 4)
    Route::get('telegram-link', [TelegramLinkController::class, 'show']);
    Route::post('telegram-link', [TelegramLinkController::class, 'store']);
    Route::delete('telegram-link', [TelegramLinkController::class, 'destroy']);
});
