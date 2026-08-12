import { useAuth } from '../contexts/AuthContext'

export function useClinicProfile() {
  const { data } = useAuth()
  return {
    name: (data?.settings.clinic_name as string) ?? '',
    phone: (data?.settings.clinic_phone as string) ?? '',
    address: (data?.settings.clinic_address as string) ?? '',
    logo: (data?.settings.clinic_logo as string) ?? '',
    footerNote: (data?.settings.invoice_footer_note as string) ?? '',
  }
}
