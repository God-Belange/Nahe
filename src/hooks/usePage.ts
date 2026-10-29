import { useEffect } from 'react'

const APP_NAME = 'Nahe?'

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : `${APP_NAME} — Le prochain rendez-vous est ici.`
  }, [title])
}

/** Pages privées : empêche l'indexation et l'envoi du Referer. */
export function usePrivatePage() {
  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    const referrer = document.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'
    document.head.append(robots, referrer)
    return () => {
      robots.remove()
      referrer.remove()
    }
  }, [])
}
