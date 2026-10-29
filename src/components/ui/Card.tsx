import type { HTMLAttributes } from 'react'
import { cx } from './cx'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('rounded-[var(--radius-card)] border border-line/70 bg-paper p-5 shadow-card sm:p-6', className)}
      {...rest}
    />
  )
}
