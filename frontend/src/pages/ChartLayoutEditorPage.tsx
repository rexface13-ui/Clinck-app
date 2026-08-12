import ToothChart from '../components/ToothChart'
import { LOWER_PERMANENT, UPPER_PERMANENT } from '../lib/dental'
import type { ToothFinding } from '../types'

/**
 * A pure layout tool, not a real patient chart — every tooth gets a fake
 * "done" finding so all 32 callout labels show at once, letting someone
 * drag every single one into place in one sitting instead of having to
 * find a real patient with work on every tooth. The saved layout (see
 * ToothChart's "رتّب أماكن الليبلات") applies to every patient's chart
 * regardless of where it was arranged from.
 */
const TEST_TEETH = [...UPPER_PERMANENT, ...LOWER_PERMANENT]

const TEST_FINDINGS: ToothFinding[] = TEST_TEETH.map((n) => ({
  id: n,
  tooth_number: n,
  surfaces: null,
  finding_type: 'خدمة تجريبية',
  status: 'done',
  marks_missing: false,
  performed_externally: false,
  work_item_tooth_step_id: null,
  session_status: null,
  session_price: null,
  plan_id: null,
  invoice_id: null,
  step_title: null,
  service_id: 1,
  service_name: 'خدمة تجريبية',
  service_color: '#3f6ea5',
  service_spans_teeth: false,
  doctor_id: null,
  doctor_name: null,
  note: null,
  recorded_at: '',
}))

export default function ChartLayoutEditorPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">ترتيب أماكن ليبلات الرسمة</h1>
        <p className="text-sm text-ink/50">
          صفحة تجريبية بس — كل سن فيها "خدمة" وهمية عشان تقدر ترتب كل الليبلات مرة وحدة. الترتيب يلي بتحفظه هون بينطبق على رسمة أي مريض فعلي.
        </p>
      </div>
      <ToothChart
        patientId={0}
        isChild={false}
        toothStates={[]}
        toothFindings={TEST_FINDINGS}
        services={[]}
        doctors={[]}
        onChanged={() => {}}
        notes={[]}
        workItems={[]}
      />
    </div>
  )
}
