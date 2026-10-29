import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Logo } from '../../components/Logo'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { TextField } from '../../components/ui/Field'
import { Alert, PageLoader } from '../../components/ui/feedback'
import { useDocumentTitle, usePrivatePage } from '../../hooks/usePage'
import { useAdminSession } from '../../lib/admin-session'
import { ApiClientError, errorMessage } from '../../lib/api'

/** Destination après connexion : uniquement un chemin interne /admin (jamais d'URL externe). */
function safeNext(value: string | null): string {
  return value && value.startsWith('/admin') && !value.startsWith('//') ? value : '/admin'
}

export default function LoginPage() {
  usePrivatePage()
  useDocumentTitle('Connexion organisateur')
  const { status, login } = useAdminSession()
  const navigate = useNavigate()
  const next = safeNext(useSearchParams()[0].get('next'))
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  if (status === 'loading') return <PageLoader />
  if (status === 'authenticated') return <Navigate to={next} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setLoading(true)
    try {
      await login(password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(
        err instanceof ApiClientError && (err.status === 401 || err.status === 429)
          ? err.message
          : errorMessage(err),
      )
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-10">
      <Logo size="xl" asLink={false} className="mb-8" />
      <Card className="w-full animate-rise">
        <h1 className="text-2xl font-extrabold">Espace organisateur</h1>
        <p className="mt-1 text-sm text-ink-soft">Connectez-vous pour gérer vos événements.</p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4" noValidate>
          {error && <Alert tone="bad">{error}</Alert>}
          <TextField
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <Button type="submit" size="lg" fullWidth loading={loading} disabled={password === ''}>
            Se connecter
          </Button>
        </form>
      </Card>
    </div>
  )
}
