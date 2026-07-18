<?php

namespace App\Services;

use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\CheckEvent;
use App\Models\CheckModel;
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
    public function __construct(protected TelegramService $telegram)
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
    ): CheckModel {
        $check = DB::transaction(function () use ($direction, $partyType, $partyId, $checkNumber, $bankName, $amount, $currency, $dueDate, $image) {
            $imagePath = $image?->store('checks', 'local');

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
                'status' => 'in_wallet',
                'received_at' => now(),
            ]);

            CheckEvent::create([
                'clinic_id' => $check->clinic_id,
                'check_id' => $check->id,
                'event_type' => 'received',
                'occurred_at' => now(),
            ]);

            return $check->fresh('events');
        });

        if ($check->image_path) {
            $this->notifyImageReceived($check);
        }

        return $check;
    }

    /**
     * Notifies every owner/accountant with a linked Telegram chat as soon as
     * a check's photo is on file, so they can verify it without opening the app.
     */
    protected function notifyImageReceived(CheckModel $check): void
    {
        $absolutePath = Storage::disk('local')->path($check->image_path);
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
     * Only valid for incoming checks still in the wallet. Endorsing to a
     * supplier settles part of what the clinic owes them, so it credits
     * the supplier ledger the same way a payment does (negative — purchase
     * amounts are stored positive as debt).
     */
    public function endorse(CheckModel $check, Supplier $supplier): CheckModel
    {
        abort_if($check->direction !== 'incoming', 422, 'التظهير متاح فقط للشيكات الواردة.');
        abort_if($check->status !== 'in_wallet', 422, 'الشيك ليس في المحفظة.');

        return DB::transaction(function () use ($check, $supplier) {
            $check->update(['status' => 'endorsed']);

            CheckEvent::create([
                'clinic_id' => $check->clinic_id,
                'check_id' => $check->id,
                'event_type' => 'endorsed',
                'endorsed_to_supplier_id' => $supplier->id,
                'occurred_at' => now(),
            ]);

            SupplierTransaction::create([
                'clinic_id' => $check->clinic_id,
                'supplier_id' => $supplier->id,
                'type' => 'check_endorsed',
                'reference_type' => 'check',
                'reference_id' => $check->id,
                'amount_ils' => -$check->amount,
                'occurred_at' => now(),
            ]);

            return $check->fresh('events');
        });
    }

    public function bounce(CheckModel $check): CheckModel
    {
        abort_if(in_array($check->status, ['bounced', 'cleared'], true), 422, 'الشيك أصبح غير قابل للتعديل.');

        return DB::transaction(function () use ($check) {
            $wasEndorsed = $check->status === 'endorsed';
            $endorsedToSupplierId = null;

            if ($wasEndorsed) {
                $endorsedToSupplierId = $check->events()
                    ->where('event_type', 'endorsed')
                    ->latest('occurred_at')
                    ->value('endorsed_to_supplier_id');
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

            return $check->fresh('events');
        });
    }

    /**
     * Clearing an incoming check that was never endorsed IS a patient
     * payment — it settles the patient's ledger and lands in a cashbox.
     * Clearing an outgoing check to a supplier settles the supplier
     * ledger. An incoming check that was already endorsed clears with no
     * further ledger effect (the endorsement already settled it).
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

                $patient = Patient::withoutGlobalScopes()->findOrFail($check->party_id);

                PatientTransaction::create([
                    'clinic_id' => $check->clinic_id,
                    'patient_id' => $patient->id,
                    'type' => 'payment',
                    'reference_type' => 'check',
                    'reference_id' => $check->id,
                    'amount' => $check->amount,
                    'currency' => $check->currency,
                    'exchange_rate' => 1,
                    'amount_ils' => $check->amount,
                    'occurred_at' => now(),
                ]);

                $cashboxService->record($cashbox, 'check_in', 'check', $check->id, (float) $check->amount);
            } elseif ($check->direction === 'outgoing') {
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

                if ($cashbox) {
                    abort_if($cashbox->currency !== $check->currency, 422, 'عملة الشيك لازم تطابق عملة الصندوق.');
                    $cashboxService->record($cashbox, 'check_out', 'check', $check->id, -(float) $check->amount);
                }
            }

            return $check->fresh('events');
        });
    }
}
