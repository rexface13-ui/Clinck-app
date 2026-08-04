/**
 * The one place currencies are defined.
 *
 * Every screen that took a currency used to hardcode its own ILS/USD/JOD
 * list — seven copies — so adding a currency meant editing seven files and
 * missing one left that screen quietly out of step. Add a currency here and
 * it appears everywhere at once.
 */
export interface Currency {
  code: string
  /** Arabic name shown next to the code. */
  name: string
  /** Short symbol used when printing an amount. */
  symbol: string
}

export const CURRENCIES: Currency[] = [
  { code: 'ILS', name: 'شيكل', symbol: '₪' },
  { code: 'JOD', name: 'دينار أردني', symbol: 'د.أ' },
  { code: 'USD', name: 'دولار', symbol: '$' },
  { code: 'EUR', name: 'يورو', symbol: '€' },
  { code: 'EGP', name: 'جنيه مصري', symbol: 'ج.م' },
  { code: 'SAR', name: 'ريال سعودي', symbol: 'ر.س' },
  { code: 'AED', name: 'درهم إماراتي', symbol: 'د.إ' },
  { code: 'TRY', name: 'ليرة تركية', symbol: '₺' },
]

/** The currency everything is ultimately reported in. */
export const BASE_CURRENCY = 'ILS'

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code
}

export function currencyLabel(code: string): string {
  const currency = CURRENCIES.find((c) => c.code === code)

  return currency ? `${currency.code} — ${currency.name}` : code
}
