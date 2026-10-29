import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from './cx'
import { Spinner } from './feedback'

type Variant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong shadow-[0_6px_16px_-6px_var(--accent)]',
  secondary: 'bg-paper text-ink border border-line hover:border-ink-muted hover:bg-cream',
  soft: 'bg-brand-soft text-brand-strong hover:brightness-95',
  ghost: 'text-ink-soft hover:bg-brand-soft hover:text-brand-strong',
  danger: 'bg-bad text-white hover:brightness-90',
}
const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-5 text-[0.95rem]',
  lg: 'min-h-12 px-7 text-base',
}

interface CommonProps {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  children: ReactNode
  className?: string
}

export function buttonClasses({ variant = 'primary', size = 'md', fullWidth, className }: CommonProps) {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    className,
  )
}

type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>

export function Button({ variant, size, loading, fullWidth, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className, children })}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}

interface LinkButtonProps extends CommonProps {
  to?: string
  href?: string
  external?: boolean
  disabled?: boolean
}

export function LinkButton({ to, href, external, disabled, variant, size, fullWidth, className, children }: LinkButtonProps) {
  const classes = buttonClasses({ variant, size, fullWidth, className, children })
  if (href || external) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener noreferrer" aria-disabled={disabled || undefined}>
        {children}
      </a>
    )
  }
  return (
    <Link to={to ?? '/'} className={classes} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}>
      {children}
    </Link>
  )
}
