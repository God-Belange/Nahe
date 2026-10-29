import { Link } from 'react-router'
import { cx } from './ui/cx'

export function Logo({ size = 'md', asLink = true, className }: { size?: 'md' | 'xl'; asLink?: boolean; className?: string }) {
  const body = (
    <span className={cx('inline-flex items-baseline font-display font-extrabold tracking-tight text-ink', size === 'xl' ? 'text-6xl sm:text-7xl' : 'text-2xl', className)} role="img" aria-label="Nahe ?">
      <span aria-hidden="true">NAHE</span>
      <span
        aria-hidden="true"
        className={cx(
          'ml-0.5 inline-grid -rotate-6 place-items-center rounded-xl bg-sun text-coral',
          size === 'xl' ? 'size-14 text-5xl sm:size-16 sm:text-6xl' : 'size-7 text-xl',
        )}
      >
        ?
      </span>
    </span>
  )
  return asLink ? <Link to="/" className="rounded-lg">{body}</Link> : body
}
