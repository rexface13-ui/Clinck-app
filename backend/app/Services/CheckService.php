<?php

namespace App\Services;

use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\CheckEvent;
use App\Models\CheckModel;
use App\Models\Invoice;
use App\Models\Patient;
use App\Models\PatientTransaction;
use App\Models\Supplier;
use App\Models\SupplierTransaction;
use App\Models\TelegramLink;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class CheckService
{
    public function __construct(protected TelegramService $telegram, protected PaymentService $payments)
    {
    }

    public function receive(
        string $direction,
        string $partyType,
        int $partyId,
        string $checkNumber,
        ?string $bankName,
        float $amount,
        string $currency,
        string $dueDate,
        ?UploadedFile $image = null,
        ?UploadedFile $image2 = null,
        ?int $invoiceId = null,
    ): CheckModel {
        // Applying a check to an invoice is what lets that invoice ever read
        // as settled; only meaningful for a patient's incoming check, and only
        // against that same patient's own invoice.
        $invoice = null;
        if ($invoiceId && $direction === 'incoming' && $partyType === 'patient') {
            $invoice = Invoice::findOrFail($invoiceId);
            abort_if($invoice->patient_id !== $partyId, 422, 'الفاتورة لا تخص هذا المريض.');
        }

        $check = DB::transaction(function () use ($direction, $partyType, $partyId, $checkNumber, $bankName, $amount, $currency, $dueDate, $image, $image2, $invoice) {
            $imagePath = $image?->store('checks', 'local');
            $imagePath2 = $image2?->store('checks', 'local');

            $check = CheckModel::create([
                'direction' => $direction,
                'party_type' => $partyType,
                'party_id' => $partyId,
                'check_number' => $checkNumber,
                'bank_name' => $bankName,
                'amount' => $amount,
                'currency' => $currency,
                'due_date' => $dueDate,
                'image_path' => $imagePath,
                'image_path_2' => $imagePath2,
                'invoice_id' => $invoice?->id,
                'status' => 'in_wallet',
                'received_at' => now(),
            ]);

            CheckEvent::create([
                'clinic_id' => $check->clinic_id,
                'check_id' => $check->id,
                'event_type' => 'received',
                'occurred_at' => now(),
            ]);

            // A check in hand settles the patient's debt immediately — the
            // clinic doesn't wait for the bank to clear it before the
            // patient's balance reflects the payment. If the check later
            // bounces, bounce() puts the charge back.
            if ($direction === 'incoming' && $partyType === 'patient') {
                PatientTransaction::create([
                    'clinic_id' => $check->clinic_id,
                    'patient_id' => $partyId,
                    'type' => 'payment',
                    'reference_type' => 'check',
                    'reference_id' => $check->id,
                    'amount' => $amount,
                    'currency' => $currency,
                    'exchange_rate' => 1,
                    'amount_ils' => $amount,
                    'occurred_at' => now(),
                ]);

                if ($invoice) {
                    $this->payments->refreshInvoiceStatus($invoice->fresh());
                }
            }

            return $check->fresh('events');
        });

        if ($check->image_path) {
            $this->notifyImageReceived($check, $check->image_path);
        }
        if ($check->image_path_2) {
            $this->notifyImageReceived($check, $check->image_path_2);
        }

        return $check;
    }

    /**
     * Notifies every owner/accountant with a linked Telegram chat as soon as
     * a check's photo is on file, so they can verify it without opening the app.
     */
    protected function notifyImageReceived(CheckModel $check, string $imagePath): void
    {
        $absolutePath = Storage::disk('local')->path($imagePath);
        $caption = sprintf(
            "📎 صورة شيك جديدة\nرقم الشيك: %s\nالمبلغ: %s %s\nتاريخ الاستحقاق: %s",
            $check->check_number,
            $check->amount,
            $check->currency,
            $check->due_date->format('Y-m-d'),
        );

        TelegramLink::whereNotNull('linked_at')
            ->get()
            ->filter(fn (TelegramLink $link) => $link->user?->hasAnyRole(['owner', 'accountant']))
            ->each(fn (TelegramLink $link) => $this->telegram->sendPhoto($link->telegram_chat_id, $absolutePath, $caption));
    }

    /**
     * Attaches (or replaces) a check's photo after it's already been
     * received — the "استلام شيك" form only asks for the first slot up
     * front, but a second side (or a photo that only becomes available
     * later) can be added afterward. `$slot` is 1 or 2.
     */
    public function attachImage(CheckModel $check, UploadedFile $image, int $slot = 1): CheckModel
    {
        $column = $slot === 2 ? 'image_path_2' : 'image_path';

        if ($check->{$column}) {
            Storage::disk('local')->delete($check->{$column});
        }

        $newPath = $image->store('checks', 'local');
        $check->update([$column => $newPath]);

        $this->notifyImageReceived($check, $newPath);

        return $check->fresh();
    }

    /**
     * Only valid for incoming checks still in the wallet. Endorsing to a
     * supplier settles part of what the clinic owes them (credits the
     * supplier ledger, negative — purchase amounts are stored positive as
     * debt). Endorsing to a patient instead hands the check over as a
     * refund — same idea, credited to the patient's ledger.
     */
    public function endorse(CheckModel $check, Supplier|Patient $target): CheckModel
    {
        abort_if($check->direction !== 'incoming', 422, 'التظهير متاح فقط للشيكات الواردة.');
        abort_if($check->status !== 'in_wallet', 422, 'الشيك ليس في المحفظة.');

        return DB::transaction(function () use ($check, $target) {
            $check->update(['status' => 'endorsed']);
            $isPatient = $target instanceof Patient;

            CheckEvent::create([
                'clinic_id' => $check->clinic_id,
                'check_id' => $check->id,
                'event_type' => 'endorsed',
                'endorsed_to_supplier_id' => $isPatient ? null : $target->id,
                'endorsed_to_patient_id' => $isPatient ? $target->id : null,
                'occurred_at' => now(),
            ]);

            if ($isPatient) {
                PatientTransaction::create([
                    'clinic_id' => $check->clinic_id,
                    'patient_id' => $target->id,
                    'type' => 'refund',
                    'reference_type' => 'check',
                    'reference_id' => $check->id,
                    'amount' => -$check->amount,
                    'currency' => $check->currency,
                    'exchange_rate' => 1,
                    'amount_ils' => -$check->amount,
                    'occurred_at' => now(),
                ]);
            } else {
                SupplierTransaction::create([
                    'clinic_id' => $check->clinic_id,
                    'supplier_id' => $target->id,
                    'type' => 'check_endorsed',
                    'reference_type' => 'check',
                    'reference_id' => $check->id,
                    'amount_ils' => -$check->amount,
                    'occurred_at' => now(),
                ]);
            }

            return $check->fresh('events');
        });
    }

    public function bounce(CheckModel $check): CheckModel
    {
        abort_if(in_array($check->status, ['bounced', 'cleared'], true), 422, 'الشيك أصبح غير قابل للتعديل.');

        return DB::transaction(function () use ($check) {
            $wasEndorsed = $check->status === 'endorsed';
            $endorsedToSupplierId = null;
            $endorsedToPatientId = null;

            if ($wasEndorsed) {
                $endorsedEvent = $check->events()
                    ->where('event_type', 'endorsed')
                    ->latest('occurred_at')
                    ->first();
                $endorsedToSupplierId = $endorsedEvent?->endorsed_to_supplier_id;
                $endorsedToPatientId = $endorsedEvent?->endorsed_to_patient_id;
            }

            $check->update(['status' => 'bounced']);

            CheckEvent::create([
                'clinic_id' => $check->clinic_id,
                'check_id' => $check->id,
                'event_type' => 'bounced',
                'occurred_at' => now(),
            ]);

            if ($wasEndorsed && $endorsedToSupplierId) {
                SupplierTransaction::create([
                    'clinic_id' => $check->clinic_id,
                    'supplier_id' => $endorsedToSupplierId,
                    'type' => 'check_bounced',
                    'reference_type' => 'check',
                    'reference_id' => $check->id,
                    'amount_ils' => $check->amount,
                    'occurred_at' => now(),
                ]);
            }

            if ($wasEndorsed && $endorsedToPatientId) {
                PatientTransaction::create([
                    'clinic_id' => $check->clinic_id,
                    'patient_id' => $endorsedToPatientId,
                    'type' => 'charge',
                    'reference_type' => 'check',
                    'reference_id' => $check->id,
                    'amount' => $check->amount,
                    'currency' => $check->currency,
                    'exchange_rate' => 1,
                    'amount_ils' => $check->amount,
                    'occurred_at' => now(),
                ]);
            }

            // receive() settled the patient's debt as soon as the check came
            // in hand (regardless of it having since been endorsed) — a
            // bounce reverses that settlement, so the debt goes back on the
            // patient's ledger.
            if ($check->direction === 'incoming' && $check->party_type === 'patient') {
                PatientTransaction::create([
                    'clinic_id' => $check->clinic_id,
                    'patient_id' => $check->party_id,
                    'type' => 'charge',
                    'reference_type' => 'check',
                    'reference_id' => $check->id,
                    'amount' => $check->amount,
                    'currency' => $check->currency,
                    'exchange_rate' => 1,
                    'amount_ils' => $check->amount,
                    'occurred_at' => now(),
                ]);
            }

            // A bounced check no longer settles anything, so the invoice it
            // was applied to has to go back to owing.
            if ($check->invoice) {
                $this->payments->refreshInvoiceStatus($check->invoice->fresh());
            }

            return $check->fresh('events');
        });
    }

    /**
     * The patient's ledger is already settled at receive() time — clearing
     * an incoming check just means the money has physically landed, so this
     * only moves the cashbox (skipped if it was already endorsed to a
     * supplier, since the cash never passed through the clinic's hands).
     * Clearing an outgoing check to a supplier settles the supplier ledger.
     */
    public function clear(CheckModel $check, ?Cashbox $cashbox, CashboxService $cashboxService): CheckModel
    {
        abort_if(in_array($check->status, ['bounced', 'cleared'], true), 422, 'الشيك أصبح غير قابل للتعديل.');

        return DB::transaction(function () use ($check, $cashbox, $cashboxService) {
            $wasInWallet = $check->status === 'in_wallet';

            $check->update(['status' => 'cleared']);

            CheckEvent::create([
                'clinic_id' => $check->clinic_id,
                'check_id' => $check->id,
                'event_type' => 'cleared',
                'occurred_at' => now(),
            ]);

            if ($check->direction === 'incoming' && $wasInWallet) {
                abort_if(! $cashbox, 422, 'اختر الصندوق الذي استُلم فيه الشيك.');
                abort_if($cashbox->currency !== $check->currency, 422, 'عملة الشيك لازم تطابق عملة الصندوق.');

                $cashboxService->record($cashbox, 'check_in', 'check', $check->id, (float) $check->amount);
            } elseif ($check->direction === 'outgoing') {
                if ($check->party_type === 'patient') {
                    $patient = Patient::withoutGlobalScopes()->findOrFail($check->party_id);

                    PatientTransaction::create([
                        'clinic_id' => $check->clinic_id,
                        'patient_id' => $patient->id,
                        'type' => 'refund',
                        'reference_type' => 'check',
                        'reference_id' => $check->id,
                        'amount' => -$check->amount,
                        'currency' => $check->currency,
                        'exchange_rate' => 1,
                        'amount_ils' => -$check->amount,
                        'occurred_at' => now(),
                    ]);
                } else {
                    $supplier = Supplier::withoutGlobalScopes()->findOrFail($check->party_id);

                    SupplierTransaction::create([
                        'clinic_id' => $check->clinic_id,
                        'supplier_id' => $supplier->id,
                        'type' => 'payment',
                        'reference_type' => 'check',
                        'reference_id' => $check->id,
                        'amount_ils' => -$check->amount,
                        'occurred_at' => now(),
                    ]);
                }

                if ($cashbox) {
                    abort_if($cashbox->currency !== $check->currency, 422, 'عملة الشيك لازم تطابق عملة الصندوق.');
                    $cashboxService->record($cashbox, 'check_out', 'check', $check->id, -(float) $check->amount);
                }
            }

            return $check->fresh('events');
        });
    }
}
