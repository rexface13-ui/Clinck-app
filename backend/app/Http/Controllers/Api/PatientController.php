<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Patient\StorePatientRequest;
use App\Http\Requests\Patient\UpdatePatientRequest;
use App\Http\Resources\AppointmentResource;
use App\Http\Resources\AttachmentResource;
use App\Http\Resources\NoteResource;
use App\Http\Resources\PatientResource;
use App\Http\Resources\ToothFindingResource;
use App\Http\Resources\ToothStateResource;
use App\Models\ActivityLog;
use App\Models\Appointment;
use App\Models\Attachment;
use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\DoctorTransaction;
use App\Models\Note;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\PatientTransaction;
use App\Models\ToothFinding;
use App\Models\WorkItem;
use App\Services\PaymentService;
use App\Support\Arabic;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PatientController extends Controller
{
    public function index(Request $request)
    {
        $this->authorize('viewAny', Patient::class);

        // Archived files stay out of every day-to-day list and picker; the
        // "المؤرشفين" view asks for them explicitly.
        $archivedOnly = $request->boolean('archived');
        $scope = fn ($query) => $archivedOnly ? $query->whereNotNull('archived_at') : $query->active();

        if ($request->filled('search')) {
            // Normalize both sides the same way (أ/إ/آ→ا, ة→ه, ى→ي, ...) so
            // a search for "احمد" also finds "أحمد", "فاطمه" finds
            // "فاطمة", etc. — the letter someone happens to type shouldn't
            // matter.
            $search = Arabic::normalize($request->input('search'));
            $nameExpr = Arabic::normalizeSql('full_name');
            $phoneExpr = Arabic::normalizeSql('phone');
            $codeExpr = Arabic::normalizeSql('code');

            return PatientResource::collection(
                $scope(Patient::query())
                    ->with('telegramLink')
                    ->where(function ($query) use ($search, $nameExpr, $phoneExpr, $codeExpr) {
                        $query->whereRaw("{$nameExpr} ilike ?", ["%{$search}%"])
                            ->orWhereRaw("{$phoneExpr} ilike ?", ["%{$search}%"])
                            ->orWhereRaw("{$codeExpr} ilike ?", ["%{$search}%"]);
                    })
                    ->orderBy('full_name')
                    ->limit(15)
                    ->get()
            );
        }

        return PatientResource::collection(
            $scope(Patient::query())->with('telegramLink')->orderByDesc('created_at')->paginate(25)
        );
    }

    public function store(StorePatientRequest $request)
    {
        $this->authorize('create', Patient::class);

        $patient = Patient::create($request->validated());

        return new PatientResource($patient);
    }

    public function show(Patient $patient)
    {
        $this->authorize('view', $patient);

        return new PatientResource($patient->load('telegramLink'));
    }

    public function update(UpdatePatientRequest $request, Patient $patient)
    {
        $this->authorize('update', $patient);

        $patient->update($request->validated());

        return new PatientResource($patient->fresh());
    }

    public function destroy(Patient $patient)
    {
        $this->authorize('delete', $patient);

        // appointments/work_items/invoices/payments/patient_transactions
        // all cascade-delete on patient_id at the DB level — for a patient
        // with any real visit or billing history that would silently wipe
        // the clinical/financial record. Block that; a patient can only be
        // removed while they're still an empty shell (added by mistake,
        // never seen).
        abort_if(
            $patient->appointments()->exists()
                || WorkItem::where('patient_id', $patient->id)->exists()
                || PatientTransaction::where('patient_id', $patient->id)->exists()
                || ToothFinding::where('patient_id', $patient->id)->exists(),
            422,
            'هذا المريض له سجل زيارات أو شغل مسجّل أو حركات مالية — لا يمكن حذفه نهائياً حفاظاً على السجل.',
        );

        $patient->delete();

        return response()->noContent();
    }

    /**
     * What the "أرشفة" dialog needs before it lets anyone press the button:
     * how the account stands and which cashboxes could fund a refund. A
     * patient the clinic holds money for (or who owes) must be given a
     * choice about that money — see archive().
     */
    public function archivePreview(Patient $patient)
    {
        $this->authorize('delete', $patient);

        $balance = $patient->ledgerBalance();

        return [
            'is_archived' => $patient->isArchived(),
            'balance_ils' => $balance,
            'credit_ils' => $balance < -0.01 ? abs($balance) : 0.0,
            'debt_ils' => $balance > 0.01 ? $balance : 0.0,
            'total_paid_ils' => round((float) Payment::where('patient_id', $patient->id)->sum('amount_ils'), 2),
            'upcoming_appointments' => $patient->appointments()->whereIn('status', ['scheduled', 'confirmed'])->where('starts_at', '>=', now())->count(),
            'open_work_items' => WorkItem::where('patient_id', $patient->id)->where('status', 'in_progress')->count(),
            'cashboxes' => Cashbox::where('currency', 'ILS')->orderBy('name')->get(['id', 'name', 'balance']),
        ];
    }

    /**
     * Archiving replaces deleting: nothing is erased — visits, work, invoices,
     * payments and the ledger all stay, so every report keeps adding up — the
     * patient just leaves the everyday lists. The one thing that can't be
     * left dangling is money: if the clinic holds the patient's money (paid
     * ahead, nothing to spend it on) it's either kept as clinic income or
     * refunded; if the patient owes, the debt either stays on the debts book
     * or is written off. Each of those is posted to the ledger and to the
     * activity log so it is visible afterwards.
     */
    public function archive(Request $request, Patient $patient, PaymentService $payments)
    {
        $this->authorize('delete', $patient);
        abort_if($patient->isArchived(), 422, 'هذا الملف مؤرشف أصلاً.');

        $data = $request->validate([
            'resolution' => ['nullable', Rule::in(['keep', 'refund', 'keep_debt', 'write_off'])],
            'cashbox_id' => ['nullable', Rule::exists('cashboxes', 'id')],
            'note' => ['nullable', 'string', 'max:1000'],
        ]);

        $balance = $patient->ledgerBalance();
        $resolution = $data['resolution'] ?? null;

        if ($balance < -0.01) {
            abort_unless(in_array($resolution, ['keep', 'refund'], true), 422, 'المريض إله مبلغ عندنا — اختار: نحتفظ فيه، أو نرجّعه إله.');
        } elseif ($balance > 0.01) {
            abort_unless(in_array($resolution, ['keep_debt', 'write_off'], true), 422, 'على المريض دين — اختار: نخلّيه دين، أو نعفيه منه.');
        } else {
            $resolution = null;
        }

        $cashbox = null;
        if ($resolution === 'refund') {
            abort_unless(! empty($data['cashbox_id']), 422, 'اختار الصندوق اللي بينرجع منه المبلغ.');
            $cashbox = Cashbox::findOrFail($data['cashbox_id']);
            abort_if($cashbox->currency !== 'ILS', 422, 'الاسترجاع بيتم من صندوق شيكل.');
            abort_if((float) $cashbox->balance + 0.001 < abs($balance), 422, 'رصيد هالصندوق ما بكفي لاسترجاع المبلغ.');
        }

        DB::transaction(function () use ($patient, $balance, $resolution, $cashbox, $data, $payments, $request) {
            $amount = abs($balance);

            if ($resolution === 'refund') {
                $payments->refund($patient, $cashbox, $amount, 'ILS', 1.0, 'cash');
            } elseif ($resolution === 'keep') {
                // Positive adjustment: zeroes the credit and books it as income.
                PatientTransaction::create([
                    'patient_id' => $patient->id,
                    'type' => 'adjustment',
                    'reference_type' => 'archive_retained_credit',
                    'reference_id' => null,
                    'note' => $data['note'] ?? null,
                    'amount' => $amount,
                    'currency' => 'ILS',
                    'exchange_rate' => 1,
                    'amount_ils' => $amount,
                    'occurred_at' => now(),
                ]);
            } elseif ($resolution === 'write_off') {
                PatientTransaction::create([
                    'patient_id' => $patient->id,
                    'type' => 'adjustment',
                    'reference_type' => 'archive_write_off',
                    'reference_id' => null,
                    'note' => $data['note'] ?? null,
                    'amount' => -$amount,
                    'currency' => 'ILS',
                    'exchange_rate' => 1,
                    'amount_ils' => -$amount,
                    'occurred_at' => now(),
                ]);
            }

            if (in_array($resolution, ['keep', 'write_off'], true)) {
                $payments->refreshPatientInvoiceStatuses($patient);
            }

            $patient->forceFill([
                'archived_at' => now(),
                'archived_by' => $request->user()->id,
                'archive_note' => $data['note'] ?? null,
            ])->save();

            $money = match ($resolution) {
                'refund' => sprintf(' — رُجّع للمريض %s ₪ من صندوق "%s"', number_format($amount, 2), $cashbox->name),
                'keep' => sprintf(' — احتفظت العيادة بمبلغ %s ₪ (سُجّل كإيراد)', number_format($amount, 2)),
                'write_off' => sprintf(' — أُعفي المريض من دين %s ₪', number_format($amount, 2)),
                'keep_debt' => sprintf(' — بقي دين %s ₪ على المريض بدفتر الديون', number_format($amount, 2)),
                default => '',
            };

            ActivityLog::record(
                'patient.archived',
                sprintf('أرشفة ملف المريض %s (%s)%s%s', $patient->full_name, $patient->code, $money, ! empty($data['note']) ? ' — ملاحظة: '.$data['note'] : ''),
                $patient,
            );
        });

        return new PatientResource($patient->fresh());
    }

    public function restore(Patient $patient)
    {
        $this->authorize('delete', $patient);
        abort_unless($patient->isArchived(), 422, 'هذا الملف مش مؤرشف.');

        $patient->forceFill(['archived_at' => null, 'archived_by' => null, 'archive_note' => null])->save();

        ActivityLog::record('patient.restored', sprintf('استرجاع ملف المريض %s (%s) من الأرشيف', $patient->full_name, $patient->code), $patient);

        return new PatientResource($patient->fresh());
    }

    /**
     * Wipes a patient AND every trace of them — appointments, work items,
     * invoices, payments, ledger, tooth chart, notes, attachments, and
     * reverses whatever side effects their (fake/test) history caused
     * elsewhere: cashbox balances inflated by their payments, and doctor
     * commissions earned off their findings. Meant for cleaning up test
     * patients, not real ones — gated behind typing the patient's exact
     * name so it can't be fired by a stray click, and still behind the same
     * permission as the normal (heavily guarded) delete above.
     */
    public function forceDestroy(Request $request, Patient $patient)
    {
        $this->authorize('delete', $patient);

        $data = $request->validate(['confirm' => ['required', 'string']]);
        abort_unless($data['confirm'] === $patient->full_name, 422, 'اكتب اسم المريض بالضبط للتأكيد.');

        DB::transaction(function () use ($patient) {
            $paymentIds = Payment::where('patient_id', $patient->id)->pluck('id');
            foreach (Payment::with('cashbox')->where('patient_id', $patient->id)->get() as $payment) {
                $payment->cashbox?->decrement('balance', $payment->amount);
            }
            CashboxTransaction::where('reference_type', 'payment')->whereIn('reference_id', $paymentIds)->delete();

            $findingIds = ToothFinding::where('patient_id', $patient->id)->pluck('id');
            DoctorTransaction::whereIn('tooth_finding_id', $findingIds)->delete();

            Note::where('notable_type', $patient->getMorphClass())->where('notable_id', $patient->id)->delete();
            Attachment::where('attachable_type', $patient->getMorphClass())->where('attachable_id', $patient->id)->delete();

            // Cascades: appointments, work_items (+ their steps), invoices
            // (+ lines), payments, patient_transactions, tooth_states,
            // tooth_findings, treatment_plans, lab_cases, prescriptions —
            // all FK cascadeOnDelete() on patient_id.
            $patient->delete();
        });

        return response()->noContent();
    }

    /**
     * Patient profile: info + tooth chart + appointments + notes, in one
     * call — this is the screen the Phase 1 deliverable centers on.
     */
    public function profile(Patient $patient)
    {
        $this->authorize('view', $patient);

        $patient->load([
            'telegramLink',
            'toothStates',
            'toothFindings' => fn ($q) => $q->orderByDesc('recorded_at')->with(['service', 'doctor', 'workItemToothStep.invoiceLine']),
            'appointments' => fn ($q) => $q->orderByDesc('starts_at')->with('doctor:id,full_name'),
            'notes' => fn ($q) => $q->orderByDesc('created_at')->with(['user:id,name', 'workItem.service:id,name', 'workItemToothStep.step:id,title']),
            'attachments' => fn ($q) => $q->orderByDesc('id')->with('uploader:id,name'),
        ]);

        return [
            'patient' => new PatientResource($patient),
            'tooth_states' => ToothStateResource::collection($patient->toothStates),
            'tooth_findings' => ToothFindingResource::collection($patient->toothFindings),
            'appointments' => AppointmentResource::collection($patient->appointments),
            'notes' => NoteResource::collection($patient->notes),
            'attachments' => AttachmentResource::collection($patient->attachments),
        ];
    }
}
