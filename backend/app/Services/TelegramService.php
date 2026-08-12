<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TelegramService
{
    /**
     * DB-backed setting wins so an owner can paste a token from the
     * Settings page without editing .env or restarting the server; falls
     * back to the env var for anyone who still configures it that way.
     */
    public function token(): string
    {
        return (string) (Setting::where('key', 'telegram_bot_token')->value('value') ?: config('telegram.bot_token'));
    }

    public function username(): string
    {
        return (string) (Setting::where('key', 'telegram_bot_username')->value('value') ?: config('telegram.bot_username'));
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

    /**
     * $keyboard is a list of button rows (each row a list of label
     * strings) shown as a persistent keyboard under the chat's input box —
     * the bot is button-driven, so almost every reply passes one. Pass an
     * empty array to explicitly clear whatever keyboard was showing
     * (ReplyKeyboardRemove); omit/null to leave the previous keyboard as-is.
     */
    public function sendMessage(int $chatId, string $text, ?array $keyboard = null): bool
    {
        if (! $this->enabled()) {
            return false;
        }

        $payload = ['chat_id' => $chatId, 'text' => $text];

        if ($keyboard !== null) {
            $payload['reply_markup'] = empty($keyboard)
                ? json_encode(['remove_keyboard' => true])
                : json_encode(['keyboard' => $keyboard, 'resize_keyboard' => true]);
        }

        try {
            $response = Http::timeout(10)->post("https://api.telegram.org/bot{$this->token()}/sendMessage", $payload);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('Telegram sendMessage failed', ['error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * Sends a photo from an absolute local file path, with an optional caption.
     */
    public function sendPhoto(int $chatId, string $absoluteFilePath, string $caption = ''): bool
    {
        if (! $this->enabled() || ! is_file($absoluteFilePath)) {
            return false;
        }

        try {
            $response = Http::timeout(20)
                ->attach('photo', file_get_contents($absoluteFilePath), basename($absoluteFilePath))
                ->post("https://api.telegram.org/bot{$this->token()}/sendPhoto", [
                    'chat_id' => $chatId,
                    'caption' => $caption,
                ]);

            return $response->successful();
        } catch (\Throwable $e) {
            Log::warning('Telegram sendPhoto failed', ['error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * Resolves a Telegram file_id (from an incoming photo message) to its
     * raw binary content — used to save a check photo a staff member sends
     * back through the bot.
     */
    public function downloadFile(string $fileId): ?string
    {
        if (! $this->enabled()) {
            return null;
        }

        try {
            $filePath = Http::timeout(15)
                ->get("https://api.telegram.org/bot{$this->token()}/getFile", ['file_id' => $fileId])
                ->json('result.file_path');

            if (! $filePath) {
                return null;
            }

            $response = Http::timeout(20)->get("https://api.telegram.org/file/bot{$this->token()}/{$filePath}");

            return $response->successful() ? $response->body() : null;
        } catch (\Throwable $e) {
            Log::warning('Telegram downloadFile failed', ['error' => $e->getMessage()]);

            return null;
        }
    }
}
