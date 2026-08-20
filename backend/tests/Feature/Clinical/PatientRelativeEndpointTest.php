<?php

namespace Tests\Feature\Clinical;

use App\Models\PatientRelative;
use Tests\TestCase;

class PatientRelativeEndpointTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs($this->owner);
    }

    public function test_linking_two_patients_creates_a_relation_visible_from_either_side(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');

        $this->postJson("/api/patients/{$a->id}/relatives", [
            'related_patient_id' => $b->id,
            'label' => 'أخت',
        ])->assertCreated();

        $this->getJson("/api/patients/{$a->id}/relatives")->assertOk()->assertJsonCount(1);
        $this->getJson("/api/patients/{$b->id}/relatives")->assertOk()->assertJsonCount(1);
    }

    public function test_a_patient_cannot_be_linked_to_themselves(): void
    {
        $a = $this->makePatient();

        $this->postJson("/api/patients/{$a->id}/relatives", [
            'related_patient_id' => $a->id,
            'label' => 'نفسه',
        ])->assertStatus(422);
    }

    public function test_the_same_pair_cannot_be_linked_twice_in_either_direction(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');

        $this->postJson("/api/patients/{$a->id}/relatives", ['related_patient_id' => $b->id, 'label' => 'أخت'])->assertCreated();

        $this->postJson("/api/patients/{$a->id}/relatives", ['related_patient_id' => $b->id, 'label' => 'أخت'])->assertStatus(422);
        // Same pair, other direction — must also be rejected as a duplicate.
        $this->postJson("/api/patients/{$b->id}/relatives", ['related_patient_id' => $a->id, 'label' => 'أخ'])->assertStatus(422);
    }

    public function test_deleting_a_relation_removes_it_from_both_sides(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $relation = PatientRelative::create(['patient_id' => $a->id, 'related_patient_id' => $b->id, 'label' => 'أخت']);

        $this->deleteJson("/api/patients/{$a->id}/relatives/{$relation->id}")->assertNoContent();

        $this->getJson("/api/patients/{$a->id}/relatives")->assertOk()->assertJsonCount(0);
        $this->getJson("/api/patients/{$b->id}/relatives")->assertOk()->assertJsonCount(0);
    }

    /** The route takes the relation id under one patient's URL, but the link may have been added from the other side — deleting from either patient's page must work. */
    public function test_a_relation_can_be_deleted_from_the_other_patients_side_too(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $relation = PatientRelative::create(['patient_id' => $a->id, 'related_patient_id' => $b->id, 'label' => 'أخت']);

        $this->deleteJson("/api/patients/{$b->id}/relatives/{$relation->id}")->assertNoContent();

        $this->assertDatabaseMissing('patient_relatives', ['id' => $relation->id]);
    }

    public function test_a_relation_belonging_to_unrelated_patients_cannot_be_deleted_through_a_third_patients_url(): void
    {
        $a = $this->makePatient('أ');
        $b = $this->makePatient('ب');
        $c = $this->makePatient('ج');
        $relation = PatientRelative::create(['patient_id' => $a->id, 'related_patient_id' => $b->id, 'label' => 'أخت']);

        $this->deleteJson("/api/patients/{$c->id}/relatives/{$relation->id}")->assertStatus(404);

        $this->assertDatabaseHas('patient_relatives', ['id' => $relation->id]);
    }
}
