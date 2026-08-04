<?php

namespace Tests\Feature;

use Tests\TestCase;

class SmokeTest extends TestCase
{
    public function test_the_test_harness_boots_a_working_clinic(): void
    {
        $patient = $this->makePatient();
        $doctor = $this->makeDoctor();
        $service = $this->makeService();
        $workItem = $this->makeWorkItem($patient, $doctor, $service, [11, 12]);

        $this->assertSame('ILS', $this->cashbox->currency);
        $this->assertNotNull($patient->code);
        $this->assertCount(2, $workItem->teeth);
        $this->assertCount(2, $workItem->toothSteps);
    }
}
