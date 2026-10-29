import type { PublicEvent } from '../../shared/types'
import { api } from '../lib/api'
import { useAsync } from './useAsync'

export type EventMode = 'slug' | 'invite'

export function usePublicEvent(mode: EventMode, param: string) {
  return useAsync(
    () => api.get<PublicEvent>(mode === 'slug' ? `/events/${encodeURIComponent(param)}` : `/invites/${encodeURIComponent(param)}`),
    [mode, param],
  )
}
