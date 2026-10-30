import { mapsUrl } from '../../shared/maps'
import { cx } from './ui/cx'

export function AddressLink({ address, className }: { address: string; className?: string }) {
  return (
    <a
      href={mapsUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className={cx('relative z-10 rounded-sm underline decoration-brand/40 underline-offset-2 hover:text-brand-strong hover:decoration-brand', className)}
    >
      {address}
      <span className="sr-only"> (ouvrir dans le plan, nouvelle fenêtre)</span>
    </a>
  )
}
