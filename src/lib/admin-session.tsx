import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import type { SessionInfo } from '../../shared/types'
import { PageLoader } from '../components/ui/feedback'
import { api, setCsrfToken, setUnauthorizedHandler } from './api'

type Status = 'loading' | 'anonymous' | 'authenticated'
interface SessionApi {
  status: Status
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionApi | null>(null)

export function useAdminSession(): SessionApi {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useAdminSession doit être utilisé dans <AdminSessionProvider>')
  return ctx
}

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')

  const apply = useCallback((info: SessionInfo) => {
    setCsrfToken(info.authenticated ? (info.csrfToken ?? null) : null)
    setStatus(info.authenticated ? 'authenticated' : 'anonymous')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => apply({ authenticated: false }))
    api.get<SessionInfo>('/admin/session').then(apply, () => setStatus('anonymous'))
    return () => setUnauthorizedHandler(null)
  }, [apply])

  const login = useCallback(
    async (password: string) => apply(await api.post<SessionInfo>('/admin/session', { password })),
    [apply],
  )
  const logout = useCallback(async () => {
    try {
      await api.delete('/admin/session')
    } finally {
      apply({ authenticated: false })
    }
  }, [apply])

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Route parente des pages admin protégées. La vraie protection est côté serveur ; ceci n'est que de l'UX. */
export function AdminGate() {
  const { status } = useAdminSession()
  const location = useLocation()
  if (status === 'loading') return <PageLoader />
  if (status === 'anonymous') {
    // Conserve la destination (ex. /admin/scan?t=… venant d'un QR code) pour y revenir après connexion.
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/admin/login?next=${next}`} replace />
  }
  return <Outlet />
}
