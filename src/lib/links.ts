import type { EventVisibility } from '../../shared/constants'

const origin = () => window.location.origin

export const eventPath = (slug: string) => `/e/${slug}`
export const invitePath = (token: string) => `/i/${token}`
export const trackingPath = (token: string) => `/r/${token}`

/** Lien public à partager pour un événement (slug si public, jeton secret si privé). */
export function shareUrl(event: { slug: string; visibility: EventVisibility; inviteToken: string }): string {
  return origin() + (event.visibility === 'private' ? invitePath(event.inviteToken) : eventPath(event.slug))
}

export const trackingUrl = (token: string) => origin() + trackingPath(token)

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
