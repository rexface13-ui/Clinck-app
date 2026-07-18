<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TelegramLink;
use Illuminate\Http\Request;

class TelegramLinkController extends Controller
{
    public function show(Request $request)
    {
        $link = TelegramLink::where('user_id', $request->user()->id)->first();

        return [
            'linked' => (bool) $link?->linked_at,
            'link_code' => $link && ! $link->linked_at ? $link->link_code : null,
            'bot_username' => config('telegram.bot_username'),
        ];
    }

    public function store(Request $request)
    {
        $code = (string) random_int(100000, 999999);

        $link = TelegramLink::updateOrCreate(
            ['user_id' => $request->user()->id],
            ['link_code' => $code, 'telegram_chat_id' => null, 'linked_at' => null],
        );

        return [
            'link_code' => $link->link_code,
            'bot_username' => config('telegram.bot_username'),
        ];
    }

    public function destroy(Request $request)
    {
        TelegramLink::where('user_id', $request->user()->id)->delete();

        return response()->noContent();
    }
}
