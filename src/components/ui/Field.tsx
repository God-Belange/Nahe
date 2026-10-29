import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { fr } from '../../lib/fr'
import { cx } from './cx'

interface ShellProps {
  label: string
  hint?: string | undefined
  error?: string | undefined
  required?: boolean | undefined
  optional?: boolean | undefined
  className?: string | undefined
  children: (aria: { id: string; 'aria-invalid': boolean | undefined; 'aria-describedby': string | undefined }) => ReactNode
}

export function FieldShell({ label, hint, error, required, optional, className, children }: ShellProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-bad" aria-hidden="true"> *</span>}
        {optional && <span className="ml-1 font-normal text-ink-muted">({fr.common.optional})</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && <p id={hintId} className="text-xs text-ink-muted">{hint}</p>}
      {error && <p id={errorId} className="flex items-center gap-1 text-sm font-medium text-bad">⚠ {error}</p>}
    </div>
  )
}

const CONTROL =
  'w-full rounded-[var(--radius-control)] border border-line bg-paper px-4 py-2.5 text-base text-ink placeholder:text-ink-muted/70 transition focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 aria-[invalid=true]:border-bad aria-[invalid=true]:ring-bad/10 disabled:bg-line/40'

type Common = Omit<ShellProps, 'children'>

export function TextField({ label, hint, error, required, optional, className, ...input }: Common & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'required'>) {
  return (
    <FieldShell {...{ label, hint, error, required, optional, className }}>
      {(aria) => <input {...aria} required={required} className={CONTROL} {...input} />}
    </FieldShell>
  )
}

export function TextAreaField({ label, hint, error, required, optional, className, ...input }: Common & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'required'>) {
  return (
    <FieldShell {...{ label, hint, error, required, optional, className }}>
      {(aria) => <textarea {...aria} rows={4} required={required} className={cx(CONTROL, 'resize-y')} {...input} />}
    </FieldShell>
  )
}

export function SelectField({ label, hint, error, required, optional, className, children, ...input }: Common & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'required'>) {
  return (
    <FieldShell {...{ label, hint, error, required, optional, className }}>
      {(aria) => <select {...aria} required={required} className={CONTROL} {...input}>{children}</select>}
    </FieldShell>
  )
}
