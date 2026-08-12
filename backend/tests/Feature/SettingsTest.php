<?php

namespace Tests\Feature;

use App\Models\Setting;
use Tests\TestCase;

class SettingsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);
    }

    /**
     * A blank optional field arrives as null (ConvertEmptyStringsToNull) and
     * settings.value is NOT NULL, so clearing the invoice footer note used to
     * 500 and take every other setting on the form down with it.
     */
    public function test_clearing_an_optional_text_setting_saves_instead_of_failing(): void
    {
        $this->putJson('/api/settings', ['values' => ['invoice_footer_note' => 'شكراً لزيارتكم']])->assertOk();

        $this->putJson('/api/settings', ['values' => ['invoice_footer_note' => '']])->assertOk();

        $this->assertSame('', Setting::where('key', 'invoice_footer_note')->value('value'));
    }

    public function test_exchange_rates_are_stored_and_read_back(): void
    {
        $this->putJson('/api/settings', ['values' => ['exchange_rates' => ['USD' => 3.75, 'JOD' => 5.2]]])->assertOk();

        // assertEquals, not assertSame: jsonb doesn't preserve key order.
        $this->assertEquals(['USD' => 3.75, 'JOD' => 5.2], Setting::where('key', 'exchange_rates')->value('value'));

        $this->assertSame(3.75, $this->getJson('/api/bootstrap')->assertOk()->json('settings.exchange_rates.USD'));
    }

    /** Only whitelisted keys may be written, so a client can't inject settings. */
    public function test_an_unknown_settings_key_is_ignored(): void
    {
        $this->putJson('/api/settings', ['values' => ['some_injected_key' => 'x']])->assertOk();

        $this->assertNull(Setting::where('key', 'some_injected_key')->first());
    }

    public function test_the_telegram_bot_token_is_never_sent_to_the_browser(): void
    {
        $this->putJson('/api/settings', ['values' => ['telegram_bot_token' => 'secret-token']])->assertOk();

        $settings = $this->getJson('/api/bootstrap')->assertOk()->json('settings');

        $this->assertArrayNotHasKey('telegram_bot_token', $settings);
    }
}
