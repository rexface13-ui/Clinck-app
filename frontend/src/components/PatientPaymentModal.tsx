import { Modal } from './ui'
import PatientLedgerPanel from './PatientLedgerPanel'

interface Props {
  patientId: number
  patientName: string
  onClose: () => void
}

/** Search → pick a patient → this pops up their ledger with the payment form open, without leaving the dashboard. */
export default function PatientPaymentModal({ patientId, patientName, onClose }: Props) {
  return (
    <Modal title={`كشف حساب — ${patientName}`} onClose={onClose} width="w-[640px]">
      <PatientLedgerPanel patientId={patientId} autoOpenPayment />
    </Modal>
  )
}
