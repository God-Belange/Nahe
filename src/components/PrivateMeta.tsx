import { usePrivatePage } from '../hooks/usePage'

/** Permet d'appliquer usePrivatePage() de façon conditionnelle (noindex + no-referrer). */
export function PrivateMeta() {
  usePrivatePage()
  return null
}
