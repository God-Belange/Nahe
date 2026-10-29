import type { ReactNode } from 'react'
import { cx } from '../ui/cx'

interface StatCardProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: string
  className?: string
}

export function StatCard({ label, value, hint, icon, className }: StatCardProps) {
  return (
    <div className={cx('rounded-[var(--radius-card)] border border-line/70 bg-paper p-5 shadow-card', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink-soft">{label}</p>
        {icon && <span aria-hidden="true" className="text-xl">{icon}</span>}
      </div>
      <p className="mt-2 font-display text-4xl font-extrabold tracking-tight">{value}</p>
      {hint && <div className="mt-1 text-sm text-ink-muted">{hint}</div>}
    </div>
  )
}
