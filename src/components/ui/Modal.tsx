import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { fr } from '../../lib/fr'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}

/** Boîte de dialogue native <dialog> : piège le focus, ferme avec Échap, restaure le focus. */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-[var(--radius-card)] bg-paper p-0 text-ink shadow-pop open:animate-pop"
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <h2 id={titleId} className="text-xl font-bold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={fr.common.close}
              className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-line/60"
            >
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
