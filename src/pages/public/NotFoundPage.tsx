import { LinkButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/feedback'
import { useDocumentTitle } from '../../hooks/usePage'
import { fr } from '../../lib/fr'

export default function NotFoundPage() {
  useDocumentTitle(fr.common.notFoundTitle)
  return (
    <EmptyState
      icon="🧭"
      title={fr.common.notFoundTitle}
      text={fr.common.notFoundText}
      action={<LinkButton to="/">{fr.common.home}</LinkButton>}
    />
  )
}
