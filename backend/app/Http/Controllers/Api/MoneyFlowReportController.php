<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cashbox;
use App\Models\CashboxTransaction;
use App\Models\CheckModel;
use App\Models\Doctor;
use App\Models\DoctorTransaction;
use App\Models\Expense;
use App\Models\Income;
use App\Models\Patient;
use App\Models\Payment;
use App\Models\PurchaseInvoice;
use App\Models\Supplier;
use App\Models\SupplierTransaction;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * "الداخل والخارج": every shekel that came in or went out, in one list, by
 * how it moved (cash / card / transfer / check).
 *
 * The cashbox ledger is the source of truth for anything that physically
 * touched a cashbox — patient payments, refunds, expenses, salary and
 * commission payouts, supplier payments, purchases paid in cash, other
 * income. Checks are different: a check is money the moment it changes
 * hands, but it only reaches a cashbox when it clears, so they're read from
 * the checks themselves and counted on the day they were received or
 * issued. The cashbox 'check_in/check_out' rows written at clearing are
 * shown for reference but never added to a total, or every cleared check
 * would be counted twice.
 */
class MoneyFlowReportController extends Controller
{
    private const METHOD_LABELS = ['cash' => 'كاش', 'card' => 'بطاقة', 'transfer' => 'تحويل', 'check' => 'شيك'];

    public function index(Request $request)
    {
        abort_unless($request->user()->can('reports.view'), 403);

        $data = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);

        $tz = config('dentaflow.display_timezone');
        $fromUtc = isset($data['from']) ? Carbon::parse($data['from'], $tz)->startOfDay()->timezone('UTC') : null;
        $toUtc = isset($data['to']) ? Carbon::parse($data['to'], $tz)->endOfDay()->timezone('UTC') : null;
        $inRange = fn ($q, string $col) => $q
            ->when($fromUtc, fn ($q) => $q->where($col, '>=', $fromUtc))
            ->when($toUtc, fn ($q) => $q->where($col, '<=', $toUtc));

        $cashboxes = Cashbox::orderBy('name')->get()->keyBy('id');
        $cashTx = $inRange(CashboxTransaction::query(), 'occurred_at')->orderBy('occurred_at')->orderBy('id')->get();

        $names = $this->lookups($cashTx);

        $rows = [];
        foreach ($cashTx as $t) {
            $rows[] = $this->cashboxRow($t, $cashboxes, $names);
        }

        $checks = $inRange(CheckModel::query(), 'received_at')->orderBy('received_at')->get();
        $patientNames = Patient::whereIn('id', $checks->where('party_type', 'patient')->pluck('party_id'))->pluck('full_name', 'id');
        $supplierNames = Supplier::whereIn('id', $checks->where('party_type', 'supplier')->pluck('party_id'))->pluck('name', 'id');
        foreach ($checks as $c) {
            $rows[] = $this->checkRow($c, $patientNames, $supplierNames, $tz);
        }

        usort($rows, fn ($a, $b) => strcmp($b['sort_key'], $a['sort_key']));

        $counted = collect($rows)->filter(fn ($r) => $r['counted']);

        return [
            'from' => $data['from'] ?? null,
            'to' => $data['to'] ?? null,
            'totals' => $this->totals($counted),
            'by_category' => $this->byCategory($counted),
            'pending_checks' => $this->pendingChecks(),
            'warnings' => $this->unpostedMovements($inRange),
            'cashboxes' => $this->cashboxBalances($cashboxes, $fromUtc, $toUtc),
            'rows' => array_map(fn ($r) => array_diff_key($r, ['sort_key' => 1]), array_slice($rows, 0, 2000)),
            'truncated' => count($rows) > 2000,
        ];
    }

    /** Batch-loads whatever each cashbox row points at, so labelling it costs no query per row. */
    private function lookups($cashTx): array
    {
        $ids = fn (string $type) => $cashTx->where('reference_type', $type)->pluck('reference_id')->unique();

        $payments = Payment::with('patient:id,full_name')->whereIn('id', $ids('payment'))->get()->keyBy('id');
        $expenses = Expense::with('category:id,name')->whereIn('id', $ids('expense'))->get()->keyBy('id');
        $incomes = Income::with('category:id,name')->whereIn('id', $ids('income'))->get()->keyBy('id');
        $doctorTx = DoctorTransaction::whereIn('id', $ids('doctor_transaction'))->get()->keyBy('id');
        $supplierTx = SupplierTransaction::whereIn('id', $ids('supplier_transaction'))->get()->keyBy('id');
        $purchases = PurchaseInvoice::whereIn('id', $ids('purchase_invoice'))->get()->keyBy('id');
        $checks = CheckModel::whereIn('id', $ids('check'))->get()->keyBy('id');

        return [
            'payments' => $payments,
            'expenses' => $expenses,
            'incomes' => $incomes,
            'doctorTx' => $doctorTx,
            'supplierTx' => $supplierTx,
            'purchases' => $purchases,
            'checks' => $checks,
            'doctors' => Doctor::whereIn('id', $doctorTx->pluck('doctor_id'))->pluck('full_name', 'id'),
            'suppliers' => Supplier::whereIn('id', $supplierTx->pluck('supplier_id')->merge($purchases->pluck('supplier_id')))->pluck('name', 'id'),
        ];
    }

    private function cashboxRow(CashboxTransaction $t, $cashboxes, array $n): array
    {
        $cashbox = $cashboxes->get($t->cashbox_id);
        $amount = (float) $t->amount;
        $currency = $cashbox?->currency ?? 'ILS';
        $direction = $amount >= 0 ? 'in' : 'out';
        $method = 'cash';
        $category = 'أخرى';
        $party = null;
        $description = null;
        $counted = true;
        $amountIls = $currency === 'ILS' ? $amount : null;

        switch ($t->reference_type) {
            case 'payment':
                $p = $n['payments']->get($t->reference_id);
                $method = $p?->method ?? 'cash';
                $party = $p?->patient?->full_name;
                // The payment already carries its own ILS value (a USD payment lands in the dollar cashbox but is worth shekels).
                $amountIls = $p ? (float) $p->amount_ils : $amountIls;
                $category = $amount >= 0 ? 'تحصيل من مريض' : 'استرجاع لمريض';
                $description = $amount >= 0 ? 'دفعة مريض' : 'مبلغ رُجّع للمريض';
                break;
            case 'expense':
                $e = $n['expenses']->get($t->reference_id);
                $category = $amount >= 0 ? 'إلغاء/تعديل مصروف' : ($e?->category?->name ?? 'مصاريف');
                $description = $e?->description;
                break;
            case 'income':
                $i = $n['incomes']->get($t->reference_id);
                $category = $amount >= 0 ? ($i?->category?->name ?? 'وارد آخر') : 'إلغاء/تعديل وارد';
                $description = $i?->description;
                break;
            case 'doctor_transaction':
                $d = $n['doctorTx']->get($t->reference_id);
                $category = 'رواتب وعمولات الأطباء';
                $party = $d ? ($n['doctors']->get($d->doctor_id)) : null;
                $description = $d?->period_month ? 'عن شهر '.Carbon::parse($d->period_month)->format('m/Y').($d->notes ? ' — '.$d->notes : '') : null;
                break;
            case 'supplier_transaction':
                $s = $n['supplierTx']->get($t->reference_id);
                $category = 'دفعة لمورد';
                $party = $s ? $n['suppliers']->get($s->supplier_id) : null;
                $description = $s?->notes;
                break;
            case 'purchase_invoice':
                $pi = $n['purchases']->get($t->reference_id);
                $category = $amount >= 0 ? 'إلغاء مشتريات نقدية' : 'مشتريات مدفوعة نقداً';
                $party = $pi ? $n['suppliers']->get($pi->supplier_id) : null;
                break;
            case 'check':
                $c = $n['checks']->get($t->reference_id);
                $method = 'check';
                $category = $amount >= 0 ? 'إيداع شيك بالصندوق' : 'صرف شيك من الصندوق';
                $description = $c ? 'شيك رقم '.$c->check_number : null;
                // Already counted when the check itself was received/issued.
                $counted = false;
                break;
        }

        return [
            'key' => 'cb-'.$t->id,
            'sort_key' => Carbon::parse($t->occurred_at)->utc()->format('Y-m-d H:i:s').sprintf('%010d', $t->id),
            'occurred_at' => display_datetime($t->occurred_at),
            'source' => 'cashbox',
            'direction' => $direction,
            'method' => $method,
            'method_label' => self::METHOD_LABELS[$method] ?? $method,
            'category' => $category,
            'party' => $party,
            'description' => $description,
            'cashbox' => $cashbox?->name,
            'currency' => $currency,
            'amount' => round(abs($amount), 2),
            'amount_ils' => $amountIls === null ? null : round(abs($amountIls), 2),
            'status' => null,
            'counted' => $counted,
        ];
    }

    private function checkRow(CheckModel $c, $patientNames, $supplierNames, string $tz): array
    {
        $incoming = $c->direction === 'incoming';
        $party = $c->party_type === 'patient' ? $patientNames->get($c->party_id) : $supplierNames->get($c->party_id);
        $statusLabels = ['in_wallet' => 'بالمحفظة', 'endorsed' => 'مظهّر', 'cleared' => 'تحصّل', 'bounced' => 'مرتجع'];
        $received = Carbon::parse($c->received_at);

        return [
            'key' => 'ck-'.$c->id,
            'sort_key' => $received->clone()->utc()->format('Y-m-d H:i:s').sprintf('%010d', $c->id),
            'occurred_at' => display_datetime($c->received_at),
            'source' => 'check',
            'direction' => $incoming ? 'in' : 'out',
            'method' => 'check',
            'method_label' => self::METHOD_LABELS['check'],
            'category' => $incoming ? 'شيك مستلم' : 'شيك مدفوع',
            'party' => $party,
            'description' => 'شيك رقم '.$c->check_number.($c->bank_name ? ' — '.$c->bank_name : '').' — استحقاق '.Carbon::parse($c->due_date)->format('d/m/Y'),
            'cashbox' => null,
            'currency' => $c->currency,
            'amount' => round((float) $c->amount, 2),
            'amount_ils' => $c->currency === 'ILS' ? round((float) $c->amount, 2) : null,
            'status' => $c->status,
            'status_label' => $statusLabels[$c->status] ?? $c->status,
            // A bounced check never became money; it stays visible but out of the totals.
            'counted' => $c->status !== 'bounced',
        ];
    }

    private function totals($counted): array
    {
        $sum = fn (string $dir, ?string $method = null) => round(
            $counted->where('direction', $dir)->when($method, fn ($c) => $c->where('method', $method))->sum(fn ($r) => $r['amount_ils'] ?? 0),
            2
        );
        $foreign = $counted->filter(fn ($r) => $r['amount_ils'] === null)->count();

        $in = $sum('in');
        $out = $sum('out');

        return [
            'in_ils' => $in,
            'out_ils' => $out,
            'net_ils' => round($in - $out, 2),
            'in_by_method' => collect(array_keys(self::METHOD_LABELS))->mapWithKeys(fn ($m) => [$m => $sum('in', $m)]),
            'out_by_method' => collect(array_keys(self::METHOD_LABELS))->mapWithKeys(fn ($m) => [$m => $sum('out', $m)]),
            'foreign_currency_rows_not_summed' => $foreign,
        ];
    }

    private function byCategory($counted): array
    {
        return $counted
            ->groupBy(fn ($r) => $r['direction'].'|'.$r['category'])
            ->map(fn ($g) => [
                'direction' => $g->first()['direction'],
                'category' => $g->first()['category'],
                'count' => $g->count(),
                'total_ils' => round($g->sum(fn ($r) => $r['amount_ils'] ?? 0), 2),
            ])
            ->sortByDesc('total_ils')
            ->values()
            ->all();
    }

    /**
     * The report reads the cashbox, so a money movement that was recorded
     * elsewhere (an expense, a salary payout, an income) but never posted to
     * a cashbox would silently be missing — and the cashbox balance would be
     * wrong too. Say so out loud instead of leaving a quiet gap.
     */
    private function unpostedMovements(callable $inRange): array
    {
        $missing = function (string $label, string $model, string $refType, string $dateCol, string $amountCol, ?callable $extra = null) use ($inRange) {
            $table = (new $model)->getTable();
            $query = $model::query()->whereNotExists(
                fn ($s) => $s->select(DB::raw(1))->from('cashbox_transactions')
                    ->whereColumn('cashbox_transactions.reference_id', "{$table}.id")
                    ->where('cashbox_transactions.reference_type', $refType)
            );
            $extra && $extra($query);
            $rows = $inRange($query, $dateCol)->get([$amountCol]);

            return $rows->isEmpty() ? null : ['label' => $label, 'count' => $rows->count(), 'total_ils' => round((float) $rows->sum($amountCol), 2)];
        };

        return array_values(array_filter([
            $missing('مصاريف مسجّلة بدون ما تنزل من الصندوق', Expense::class, 'expense', 'spent_at', 'amount_ils'),
            $missing('وارد مسجّل بدون ما يدخل الصندوق', Income::class, 'income', 'received_at', 'amount_ils'),
            $missing('صرف رواتب/عمولات مسجّل بدون ما ينزل من الصندوق', DoctorTransaction::class, 'doctor_transaction', 'settled_at', 'amount_ils', fn ($q) => $q->where('type', 'settlement')),
        ]));
    }

    /** Checks that are money on paper but not yet in (or out of) any cashbox — whatever the report's date range. */
    private function pendingChecks(): array
    {
        $open = CheckModel::whereIn('status', ['in_wallet', 'endorsed'])->get();

        return [
            'incoming_ils' => round((float) $open->where('direction', 'incoming')->where('currency', 'ILS')->sum('amount'), 2),
            'incoming_count' => $open->where('direction', 'incoming')->count(),
            'outgoing_ils' => round((float) $open->where('direction', 'outgoing')->where('currency', 'ILS')->sum('amount'), 2),
            'outgoing_count' => $open->where('direction', 'outgoing')->count(),
        ];
    }

    /** Opening → movement → closing per cashbox for the range; for an open-ended range the closing equals the live balance. */
    private function cashboxBalances($cashboxes, ?Carbon $fromUtc, ?Carbon $toUtc): array
    {
        return $cashboxes->map(function (Cashbox $c) use ($fromUtc, $toUtc) {
            $opening = $fromUtc
                ? (float) CashboxTransaction::where('cashbox_id', $c->id)->where('occurred_at', '<', $fromUtc)->sum('amount')
                : 0.0;
            $movement = (float) CashboxTransaction::where('cashbox_id', $c->id)
                ->when($fromUtc, fn ($q) => $q->where('occurred_at', '>=', $fromUtc))
                ->when($toUtc, fn ($q) => $q->where('occurred_at', '<=', $toUtc))
                ->sum('amount');

            return [
                'id' => $c->id,
                'name' => $c->name,
                'currency' => $c->currency,
                'opening' => round($opening, 2),
                'movement' => round($movement, 2),
                'closing' => round($opening + $movement, 2),
                'current_balance' => round((float) $c->balance, 2),
            ];
        })->values()->all();
    }
}
