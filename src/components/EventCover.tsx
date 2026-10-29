import { useState } from 'react'
import { cx } from './ui/cx'

/** Image de couverture, avec dégradé aux couleurs de l'accent si absente ou en erreur. */
export function EventCover({ src, alt = '', className, eager }: { src: string | null; alt?: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div
        aria-hidden="true"
        className={cx('grid place-items-center bg-[linear-gradient(135deg,var(--accent),var(--accent-strong))] text-6xl', className)}
      >
        <span className="drop-shadow">🎉</span>
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={cx('object-cover', className)}
    />
  )
}
