<?php

namespace App\Providers;

use App\Models\Appointment;
use App\Models\Attachment;
use App\Models\CheckModel;
use App\Models\Expense;
use App\Models\Income;
use App\Models\Invoice;
use App\Models\Note;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\PurchaseInvoice;
use App\Models\Supplier;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Keeps polymorphic *_type columns (notes.notable_type,
        // patient_transactions.reference_type, ...) as short stable
        // strings instead of full class names.
        Relation::morphMap([
            'patient' => Patient::class,
            'appointment' => Appointment::class,
            'invoice' => Invoice::class,
            'payment' => Payment::class,
            'expense' => Expense::class,
            'income' => Income::class,
            'note' => Note::class,
            'attachment' => Attachment::class,
            'supplier' => Supplier::class,
            'purchase_invoice' => PurchaseInvoice::class,
            'check' => CheckModel::class,
        ]);
    }
}
