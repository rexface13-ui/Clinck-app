<?php

namespace App\Http\Requests\Appointment;

use App\Models\Appointment;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateAppointmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'branch_id' => ['sometimes', 'required', Rule::exists('branches', 'id')],
            'doctor_id' => ['sometimes', 'nullable', Rule::exists('doctors', 'id')],
            'starts_at' => ['sometimes', 'required', 'date'],
            'ends_at' => ['sometimes', 'required', 'date', 'after:starts_at'],
            'status' => ['sometimes', 'required', Rule::in(['scheduled', 'confirmed', 'done', 'cancelled', 'no_show'])],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty() || (! $this->has('starts_at') && ! $this->has('ends_at'))) {
                return;
            }

            /** @var Appointment $appointment */
            $appointment = $this->route('appointment');

            $doctorId = $this->input('doctor_id', $appointment->doctor_id);
            $startsAt = $this->input('starts_at', $appointment->starts_at);
            $endsAt = $this->input('ends_at', $appointment->ends_at);
            $status = $this->input('status', $appointment->status);

            if (in_array($status, ['cancelled', 'no_show'], true) || ! $doctorId) {
                return;
            }

            $overlaps = Appointment::where('doctor_id', $doctorId)
                ->whereNotIn('status', ['cancelled', 'no_show'])
                ->whereKeyNot($appointment->id)
                ->where('starts_at', '<', $endsAt)
                ->where('ends_at', '>', $startsAt)
                ->exists();

            if ($overlaps) {
                $validator->errors()->add('starts_at', 'الطبيب لديه موعد آخر في هذا الوقت.');
            }
        });
    }
}
