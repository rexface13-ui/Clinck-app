import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'

function Field({ label, error, children }: { label?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      {label && <label className="mb-1 block text-sm text-muted">{label}</label>}
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className = '', ...rest }: InputProps) {
  return (
    <Field label={label} error={error}>
      <input
        className={`w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 ${className}`}
        {...rest}
      />
    </Field>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

export function Select({ label, error, className = '', children, ...rest }: SelectProps) {
  return (
    <Field label={label} error={error}>
      <select
        className={`w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 ${className}`}
        {...rest}
      >
        {children}
      </select>
    </Field>
  )
}
