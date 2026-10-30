import type { ReactNode } from 'react'
import { Button } from './ui/Button'
import { useToast } from './ui/Toast'
import { fr } from '../lib/fr'

interface ShareButtonProps {
  text: string
  title?: string
  label?: ReactNode
  variant?: 'secondary' | 'soft'
  size?: 'sm' | 'md'
  fullWidth?: boolean
}

/** Ouvre la feuille de partage du système (WhatsApp, SMS, Instagram…) ; à défaut, copie le message. */
export function ShareButton({ text, title, label = fr.common.share, variant = 'soft', size = 'sm', fullWidth }: ShareButtonProps) {
  const toast = useToast()
  async function share() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text })
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) toast.show(fr.common.shareFailed, 'bad')
      }
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.show(fr.common.shareCopied)
    } catch {
      toast.show(fr.common.shareFailed, 'bad')
    }
  }
  return (
    <Button variant={variant} size={size} fullWidth={fullWidth} onClick={share}>
      <span aria-hidden="true">📤</span> {label}
    </Button>
  )
}
