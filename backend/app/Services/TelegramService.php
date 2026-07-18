<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TelegramService
{
    protected function token(): string
    {
        return (string) config('telegram.bot_token');
    }

    protected function enabled(): bool
    {
        return $this->token() !== '';
    }

    /**
     * Poll for new updates since $offset. Returns an empty array if the bot
     * isn't configured yet or the request fails.
     */
    public function getUpdates(int $offset): array
    {
        if (! $this->enabled()) {
            return [];
        }

        try {
            $response = Http::timeout(35)->get("https://api.telegram.org/bot{$this->token()}/getUpdates", [
                'offset' => $offset,
                'timeout' => 30,
            ]);

            return $response->json('result', []);
        } catch (\Throwable $e) {
            Log::warning('Telegram getUpdates failed', ['error' => $e->getMessage()]);

            return [];
        }
    }

    public function sendMessage(int $chatId, string $text): bool
    {
        if (! $this->enabled()) {
            return false;
        }

        try {
            $response = Http::timeout(10)->post("https://api.telegram.org/bot{$this->token()}/sendMessage", [
                'chat_id' => $chatId,
                'text' => $text,
            ]);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('Telegram sendMessage failed', ['error' => $e->getMessage()]);

            return false;
        }
    }
}
