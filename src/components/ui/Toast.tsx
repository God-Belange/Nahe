import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { cx } from './cx'

type Tone = 'ok' | 'bad' | 'info'
interface ToastItem { id: number; tone: Tone; text: string }
interface ToastApi { show: (text: string, tone?: Tone) => void }

const ToastContext = createContext<ToastApi>({ show: () => undefined })
export const useToast = () => useContext(ToastContext)

const TONE: Record<Tone, string> = {
  ok: 'bg-ok text-white',
  bad: 'bg-bad text-white',
  info: 'bg-ink text-white',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const show = useCallback((text: string, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((list) => [...list, { id, tone, text }])
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500)
  }, [])
  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div key={t.id} role="status" className={cx('pointer-events-auto max-w-md animate-pop rounded-full px-5 py-3 text-sm font-semibold shadow-pop', TONE[t.tone])}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
