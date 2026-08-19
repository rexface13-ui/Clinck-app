<?php

namespace App\Console\Commands;

use App\Models\CheckModel;
use App\Services\CheckService;
use App\Support\Tenancy\CurrentClinic;
use Illuminate\Console\Command;

class TelegramNotifyCheckImage extends Command
{
    protected $signature = 'telegram:notify-check-image {checkId} {imagePath}';

    protected $description = 'Sends a just-added check image to every linked owner/accountant. Launched as a detached process by CheckService so a slow/unreachable Telegram never blocks the request that saved the check.';

    public function handle(CheckService $service): int
    {
        CurrentClinic::set((int) config('dentaflow.local_clinic_id'));

        $check = CheckModel::find((int) $this->argument('checkId'));
        if (! $check) {
            return self::SUCCESS;
        }

        $service->notifyImageReceived($check, (string) $this->argument('imagePath'));

        return self::SUCCESS;
    }
}
