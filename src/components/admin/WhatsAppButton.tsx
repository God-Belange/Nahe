import { LinkButton } from '../ui/Button'
import { whatsappUrl } from '../../lib/links'

export function WhatsAppButton({ text, label = 'WhatsApp' }: { text: string; label?: string }) {
  return (
    <LinkButton href={whatsappUrl(text)} variant="soft" size="sm">
      💬 {label}
    </LinkButton>
  )
}
