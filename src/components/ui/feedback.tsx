import type { ReactNode } from 'react'
import { fr } from '../../lib/fr'
import { cx } from './cx'

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded-xl bg-line/70', className)} />
}

export function PageLoader({ label = fr.common.loading }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-24 text-ink-muted">
      <Spinner className="size-6 text-brand" />
      <span>{label}</span>
    </div>
  )
}

interface StateProps {
  icon?: ReactNode
  title: string
  text?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon = '🎈', title, text, action, className }: StateProps) {
  return (
    <div className={cx('mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center', className)}>
      <div className="text-5xl" aria-hidden="true">{icon}</div>
      <h2 className="text-2xl font-bold">{title}</h2>
      {text && <p className="text-ink-soft">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <div className="text-5xl" aria-hidden="true">🫠</div>
      <h2 className="text-2xl font-bold">Oups…</h2>
      <p className="text-ink-soft">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex min-h-11 items-center rounded-full bg-brand px-5 font-semibold text-white hover:bg-brand-strong"
        >
          {fr.common.retry}
        </button>
      )}
    </div>
  )
}

type AlertTone = 'info' | 'ok' | 'warn' | 'bad'
const ALERT: Record<AlertTone, string> = {
  info: 'bg-brand-soft text-ink border-brand/30',
  ok: 'bg-ok-soft text-ok border-ok/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  bad: 'bg-bad-soft text-bad border-bad/30',
}

export function Alert({ tone = 'info', title, children, className }: { tone?: AlertTone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('rounded-2xl border px-4 py-3 text-sm leading-relaxed', ALERT[tone], className)}>
      {title && <p className="font-bold">{title}</p>}
      {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
    </div>
  )
}
