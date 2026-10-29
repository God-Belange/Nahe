import { useState } from 'react'
import { fr } from '../../lib/fr'
import { Button } from './Button'
import { useToast } from './Toast'

export function CopyButton({ value, label = fr.common.copy, size = 'sm', variant = 'secondary' }: { value: string; label?: string; size?: 'sm' | 'md'; variant?: 'secondary' | 'soft' }) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.show('Copie impossible : sélectionnez le texte manuellement.', 'bad')
    }
  }
  return (
    <Button variant={variant} size={size} onClick={copy} aria-live="polite">
      {copied ? `✓ ${fr.common.copied}` : label}
    </Button>
  )
}
