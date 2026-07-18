<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Bot Token / Username
    |--------------------------------------------------------------------------
    |
    | Obtained from @BotFather. Left empty until a real bot is created —
    | TelegramService fails soft (returns false) when empty so telegram:poll
    | and telegram:send-reminders don't crash without a token.
    |
    */

    'bot_token' => env('TELEGRAM_BOT_TOKEN', ''),

    'bot_username' => env('TELEGRAM_BOT_USERNAME', ''),

];
