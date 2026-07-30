export interface Branch {
  id: number
  name: string
  is_main?: boolean
  is_active?: boolean
}

export interface BootstrapData {
  user: { id: number; name: string; email: string }
  roles: string[]
  permissions: string[]
  features: Record<string, boolean>
  settings: Record<string, unknown>
  branches: Branch[]
}

export interface Doctor {
  id: number
  user_id: number | null
  full_name: string
  contract_type: 'salary' | 'salary_commission' | 'commission' | 'independent'
  commission_direction: 'clinic_pays' | 'clinic_receives' | null
  default_commission_percent: string | null
  monthly_salary: string | null
  is_active: boolean
  availability?: DoctorAvailability[]
  service_commissions?: { id: number; service_id: number; service_name: string; commission_percent: string }[]
}

export interface DoctorAvailability {
  id: number
  branch_id: number
  weekday: number
  start_time: string
  end_time: string
}

export interface ServiceCategory {
  id: number
  name: string
  sort_order: number
}

export interface ServiceStepField {
  id: number
  label: string
  sort_order: number
}

export interface ServiceStep {
  id: number
  title: string
  price: string
  sort_order: number
  fields: ServiceStepField[]
}

export interface Service {
  id: number
  service_category_id: number | null
  name: string
  default_price: string
  default_currency: string
  default_sessions: number
  default_interval_days: number | null
  default_commission_percent: string | null
  is_active: boolean
  marks_teeth_missing: boolean
  allows_missing_teeth: boolean
  price_per_tooth: boolean
  color: string | null
  spans_teeth: boolean
  branch_prices?: { id: number; branch_id: number; price: string | null; surcharge: string }[]
  steps?: ServiceStep[]
}

export interface Patient {
  id: number
  code: string
  branch_id: number
  full_name: string
  birth_date: string | null
  gender: 'male' | 'female'
  is_child: boolean
  phone: string | null
  guardian_name: string | null
  guardian_phone: string | null
  medical_alerts: string[]
  medical_notes: string | null
  created_at: string
}

export interface ToothState {
  tooth_number: number
  status: 'present' | 'missing'
}

export interface ToothFinding {
  id: number
  tooth_number: number
  surfaces: string | null
  finding_type: string
  status: 'planned' | 'in_progress' | 'done'
  marks_missing: boolean
  performed_externally: boolean
  work_item_tooth_step_id: number | null
  session_status: 'pending' | 'done' | null
  session_price: string | null
  plan_id: number | null
  service_id: number | null
  service_name: string | null
  service_color: string | null
  service_spans_teeth: boolean
  doctor_id: number | null
  doctor_name: string | null
  note: string | null
  recorded_at: string
}

export interface Appointment {
  id: number
  branch_id: number
  patient_id: number
  patient_name: string | null
  doctor_id: number | null
  doctor_name: string | null
  starts_at: string
  ends_at: string
  starts_at_display: string
  status: 'scheduled' | 'confirmed' | 'done' | 'cancelled' | 'no_show'
  created_via: 'web' | 'bot'
  notes?: string | null
  work_items?: {
    id: number
    service_name: string | null
    service_color: string | null
    doctor_name: string | null
    status: string
    teeth: number[]
    pending: { tooth_number: number; step_title: string }[]
  }[]
  has_pending_work?: boolean
  follow_up_appointment?: { id: number; starts_at_display: string } | null
}

export interface AppointmentTimelineEntry {
  id: number
  user_name: string
  action: string
  description: string
  created_at: string
}

export interface Attachment {
  id: number
  original_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: string | null
  created_at: string
  download_url: string
}

export interface Note {
  id: number
  body: string
  author: string | null
  created_at: string
  tooth_number: number | null
  is_important: boolean
}

export interface PatientProfile {
  patient: Patient
  tooth_states: ToothState[]
  tooth_findings: ToothFinding[]
  appointments: Appointment[]
  notes: Note[]
  attachments: Attachment[]
}

export interface Slot {
  starts_at: string
  ends_at: string
  starts_at_display: string
  ends_at_display: string
}

export interface WorkItemToothStepRow {
  id: number
  tooth_number: number
  field_values: Record<string, string>
  completed: boolean
  invoiced: boolean
  /** Only meaningful once invoiced — when this tooth-step was billed, i.e. which prior session it belongs to. */
  completed_at: string | null
}

export interface WorkItemStepRow {
  id: number
  title: string
  price: string
  sort_order: number
  fields: ServiceStepField[]
  tooth_steps: WorkItemToothStepRow[]
}

export interface WorkItem {
  id: number
  patient_id: number
  doctor_id: number | null
  doctor_name: string | null
  service_id: number | null
  service_name: string | null
  service_color: string | null
  service_spans_teeth: boolean
  appointment_id: number | null
  price_per_tooth: boolean
  status: 'in_progress' | 'done' | 'cancelled'
  created_at: string
  teeth: number[]
  steps: WorkItemStepRow[]
}

export interface InvoiceLine {
  id: number
  description: string
  amount: string
  currency: string
  amount_ils: string
}

export interface Invoice {
  id: number
  patient_id: number
  invoice_number: string
  status: 'unpaid' | 'partial' | 'paid' | 'void'
  total_amount_ils: string
  paid_ils?: number
  issued_at: string
  lines?: InvoiceLine[]
}

export interface Payment {
  id: number
  invoice_id: number | null
  cashbox_id: number
  amount: string
  currency: string
  exchange_rate: string
  amount_ils: string
  method: 'cash' | 'card' | 'transfer'
  paid_at: string
}

export interface LedgerRow {
  id: number
  type: 'charge' | 'payment' | 'refund' | 'adjustment'
  reference_type: string
  reference_id: number
  amount: string
  currency: string
  amount_ils: string
  balance_after_ils: number
  occurred_at: string
}

export interface Ledger {
  outstanding_ils: number
  transactions: LedgerRow[]
}

export interface Visit {
  session_id: number | null
  item_id: number | null
  plan_id: number | null
  batch_id: string | null
  appointment_id: number | null
  appointment_date: string | null
  created_at: string
  date: string
  service_name: string | null
  step_title?: string | null
  tooth_number: number | null
  tooth_numbers: number[] | null
  price: string
  note: string | null
  doctor_name: string | null
  is_quick_visit: boolean
  invoice_id: number
  invoice_status: 'unpaid' | 'partial' | 'paid' | 'void'
}

export interface Cashbox {
  id: number
  branch_id: number
  currency: string
  name: string
  balance: string
  branch?: { id: number; name: string }
}

export interface ExpenseCategory {
  id: number
  name: string
}

export interface IncomeCategory {
  id: number
  name: string
}

export interface CashEntry {
  id: number
  expense_category_id?: number
  income_category_id?: number | null
  category: string
  cashbox_id: number
  cashbox: string
  amount: string
  currency: string
  amount_ils: string
  description: string | null
  spent_at?: string
  received_at?: string
  /** Incomes only — 'income' is a manual entry (editable/deletable here), 'payment' is a patient payment collection (read-only, managed from the patient's ledger). */
  kind?: 'income' | 'payment'
  source_id?: number | null
  editable?: boolean
}

export interface Supplier {
  id: number
  name: string
  phone: string | null
  is_active: boolean
  outstanding_ils: number
}

export interface SupplierLedgerRow {
  id: number
  type: 'purchase' | 'payment' | 'check_endorsed' | 'check_bounced' | 'adjustment'
  reference_type: string | null
  reference_id: number | null
  amount_ils: string
  balance_after_ils: number
  occurred_at: string
}

export interface SupplierLedger {
  outstanding_ils: number
  transactions: SupplierLedgerRow[]
}

export interface ItemCategory {
  id: number
  name: string
}

export interface Item {
  id: number
  item_category_id: number | null
  name: string
  type: 'direct_expense' | 'simple_stock' | 'tracked'
  unit: string
  is_active: boolean
  category?: { id: number; name: string } | null
}

export interface PurchaseInvoiceLine {
  id: number
  item_id: number
  item?: Item
  quantity: string
  unit_price: string
  currency: string
  amount_ils: string
  item_lot_id: number | null
  lot_number: string | null
  expiry_date: string | null
}

export interface PurchaseInvoice {
  id: number
  supplier_id: number
  supplier?: Supplier
  branch_id: number
  branch?: { id: number; name: string }
  invoice_number: string | null
  status: 'draft' | 'confirmed'
  total_amount_ils: string
  issued_at: string
  notes?: string | null
  lines?: PurchaseInvoiceLine[]
}

export interface LabCase {
  id: number
  patient_id: number
  patient_name: string | null
  doctor_id: number | null
  doctor_name: string | null
  supplier_id: number
  supplier_name: string | null
  description: string
  tooth_numbers: number[] | null
  sent_at: string
  expected_return_date: string
  status: 'sent' | 'ready' | 'received'
  notes: string | null
  received_at: string | null
  is_overdue: boolean
}

export interface Prescription {
  id: number
  patient_id: number
  doctor_id: number | null
  doctor_name: string | null
  medications: string
  notes: string | null
  created_at: string
}

export interface StockMovement {
  id: number
  branch_id: number
  item_id: number
  item?: Item
  item_lot_id: number | null
  type: 'purchase_in' | 'manual_out' | 'adjustment'
  quantity: string
  occurred_at: string
}

export interface CheckEvent {
  id: number
  check_id: number
  event_type: 'received' | 'endorsed' | 'bounced' | 'cleared'
  endorsed_to_supplier_id: number | null
  occurred_at: string
  notes: string | null
}

export interface CheckItem {
  id: number
  direction: 'incoming' | 'outgoing'
  party_type: 'patient' | 'supplier'
  party_id: number
  check_number: string
  bank_name: string | null
  amount: string
  currency: string
  due_date: string
  image_path: string | null
  status: 'in_wallet' | 'endorsed' | 'bounced' | 'cleared'
  received_at: string
  events?: CheckEvent[]
}

export interface CommissionStatement {
  doctor: { id: number; full_name: string; contract_type: Doctor['contract_type'] }
  month: string
  commission_total_ils: number
  salary_due_ils: number
  total_due_ils: number
  paid_ils: number
  remaining_ils: number
  transactions: {
    id: number
    amount_ils: string
    patient_name: string | null
    tooth_number: number | null
    surfaces: string | null
    service_name: string | null
    finding_type: string | null
    finding_status: 'planned' | 'in_progress' | 'done' | null
    note: string | null
    recorded_at: string | null
    invoice_number: string | null
    invoice_status: 'unpaid' | 'partial' | 'paid' | 'void' | null
    invoice_total_ils: number | null
    invoice_paid_ils: number | null
  }[]
  payouts: {
    id: number
    amount_ils: string
    notes: string | null
    paid_at: string | null
  }[]
}
