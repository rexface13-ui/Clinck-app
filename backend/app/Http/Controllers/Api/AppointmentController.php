<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Appointment\StoreAppointmentRequest;
use App\Http\Requests\Appointment\UpdateAppointmentRequest;
use App\Http\Resources\AppointmentResource;
use App\Models\ActivityLog;
use App\Models\Appointment;
use App\Models\Setting;
use App\Models\TelegramLink;
use App\Models\WorkItem;
use App\Services\TelegramService;
use App\Support\Arabic;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AppointmentController extends Controller
{
    private const STATUS_LABELS_AR = [
        'scheduled' => 'مجدول',
        'confirmed' => 'مؤكد',
        'done' => 'حضر',
        'cancelled' => 'ملغى',
        'no_show' => 'لم يحضر',
    ];

    public function index(Request $request)
    {
        $this->authorize('viewAny', Appointment::class);

        $query = Appointment::with(['patient:id,full_name', 'doctor:id,full_name']);

        if ($request->filled('doctor_id')) {
            $query->where('doctor_id', $request->input('doctor_id'));
        }

        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->input('branch_id'));
        }

        if ($request->filled('from')) {
            $query->where('starts_at', '>=', $request->input('from'));
        }

        if ($request->filled('to')) {
            $query->where('starts_at', '<=', $request->input('to'));
        }

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->filled('search')) {
            $search = Arabic::normalize($request->input('search'));
            $query->whereHas('patient', fn ($p) => $p->whereRaw(Arabic::normalizeSql('full_name').' ilike ?', ["%{$search}%"]));
        }

        return AppointmentResource::collection($query->orderByDesc('starts_at')->get());
    }

    public function store(StoreAppointmentRequest $request, TelegramService $telegram)
    {
        $this->authorize('create', Appointment::class);

        $appointment = Appointment::create($request->validated() + [
            'status' => 'scheduled',
            'created_via' => 'web',
        ]);

        $appointment->load(['patient', 'doctor']);

        ActivityLog::record(
            'appointment.created',
            sprintf('حجز موعد جديد لـ %s مع %s بتاريخ %s', $appointment->patient?->full_name, $appointment->doctor?->full_name ?? 'بدون طبيب', $appointment->starts_at->format('d/m/Y H:i')),
            $appointment,
        );

        $notifyEnabled = Setting::where('key', 'notify_new_appointment_enabled')->value('value');
        if ($notifyEnabled !== false) {
            $link = TelegramLink::activeForDoctor($appointment->doctor);
            if ($link) {
                $telegram->sendMessage(
                    (int) $link->telegram_chat_id,
                    sprintf("📅 موعد جديد!\n%s — %s", $appointment->starts_at->format('d/m/Y H:i'), $appointment->patient?->full_name),
                );
            }
        }

        return new AppointmentResource($appointment);
    }

    public function show(Appointment $appointment)
    {
        $this->authorize('view', $appointment);

        return new AppointmentResource($appointment->load([
            'patient', 'doctor', 'workItems.service', 'workItems.doctor', 'workItems.teeth', 'workItems.steps.toothSteps',
        ]));
    }

    public function update(UpdateAppointmentRequest $request, Appointment $appointment)
    {
        $this->authorize('update', $appointment);

        $previousStatus = $appointment->status;
        $data = $request->validated();

        $appointment->update($data);

        if (array_key_exists('status', $data) && $data['status'] !== $previousStatus) {
            ActivityLog::record(
                'appointment.status_changed',
                sprintf('%s → %s', self::STATUS_LABELS_AR[$previousStatus] ?? $previousStatus, self::STATUS_LABELS_AR[$data['status']] ?? $data['status']),
                $appointment,
            );
        }

        return new AppointmentResource($appointment->fresh(['patient', 'doctor']));
    }

    public function timeline(Appointment $appointment)
    {
        $this->authorize('view', $appointment);

        return ActivityLog::where('subject_type', Appointment::class)
            ->where('subject_id', $appointment->id)
            ->orderBy('created_at')
            ->get()
            ->map(fn (ActivityLog $log) => [
                'id' => $log->id,
                'user_name' => $log->user_name,
                'action' => $log->action,
                'description' => $log->description,
                'created_at' => display_datetime($log->created_at),
            ]);
    }

    public function destroy(Appointment $appointment)
    {
        $this->authorize('delete', $appointment);

        // A work item that already billed something under this appointment
        // can't be silently unwound by deleting the appointment — the charge
        // stays real either way. Block it instead of leaving an orphaned
        // invoice with no visible link back to a visit.
        $hasBilledWork = WorkItem::where('appointment_id', $appointment->id)
            ->whereHas('toothSteps', fn ($q) => $q->whereNotNull('invoice_line_id'))
            ->exists();
        abort_if($hasBilledWork, 422, 'ما فيك تحذف هالموعد — في شغل محسوب عليه. عدّل الفاتورة من ملف المريض أولاً.');

        $appointment->loadMissing(['patient:id,full_name', 'doctor:id,full_name']);
        ActivityLog::record('appointment.deleted', sprintf(
            'حذف موعد %s مع %s بتاريخ %s',
            $appointment->patient?->full_name ?? 'مريض محذوف',
            $appointment->doctor?->full_name ?? 'بدون طبيب',
            $appointment->starts_at->format('d/m/Y H:i'),
        ));

        DB::transaction(function () use ($appointment) {
            // Any not-yet-billed work item this appointment was scheduled for
            // just loses that link — the work itself (if any progress was
            // saved) stays, it just needs a new appointment to continue.
            WorkItem::where('appointment_id', $appointment->id)->update(['appointment_id' => null]);

            $appointment->delete();
        });

        return response()->noContent();
    }
}
