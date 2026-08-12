<?php

namespace App\Http\Requests\Appointment;

use App\Models\Appointment;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreAppointmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'branch_id' => ['required', Rule::exists('branches', 'id')],
            'patient_id' => ['required', Rule::exists('patients', 'id')],
            'doctor_id' => ['nullable', Rule::exists('doctors', 'id')],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after:starts_at'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty() || ! $this->input('doctor_id')) {
                // No doctor assigned yet — nothing to check for a scheduling
                // conflict against (the visit itself is still valid, just
                // unassigned).
                return;
            }

            $overlaps = Appointment::where('doctor_id', $this->input('doctor_id'))
                ->whereNotIn('status', ['cancelled', 'no_show'])
                ->where('starts_at', '<', $this->input('ends_at'))
                ->where('ends_at', '>', $this->input('starts_at'))
                ->when($this->route('appointment'), fn ($q, $appointment) => $q->whereKeyNot($appointment->id))
                ->exists();

            if ($overlaps) {
                $validator->errors()->add('starts_at', 'الطبيب لديه موعد آخر في هذا الوقت.');
            }
        });
    }
}
