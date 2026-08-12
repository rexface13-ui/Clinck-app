import type { SelectHTMLAttributes } from 'react'
import { CURRENCIES, currencyLabel } from '../../lib/currencies'

/**
 * Currency picker backed by the shared list, so every screen offers the same
 * currencies. Pass `showNames` for the roomier forms (settings, new cashbox)
 * and leave it off where the field sits inline next to an amount.
 */
export default function CurrencySelect({
  showNames = false,
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { showNames?: boolean }) {
  return (
    <select
      {...rest}
      className={`rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none ${className}`}
    >
      {CURRENCIES.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {showNames ? currencyLabel(currency.code) : currency.code}
        </option>
      ))}
    </select>
  )
}
