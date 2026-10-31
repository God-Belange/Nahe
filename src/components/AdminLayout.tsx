import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAdminSession } from '../lib/admin-session'
import { usePrivatePage } from '../hooks/usePage'
import { Logo } from './Logo'
import { Button } from './ui/Button'

const LINKS = [
  { to: '/admin', label: 'Tableau de bord', end: true },
  { to: '/admin/evenements', label: 'Événements', end: false },
  { to: '/admin/reservations', label: 'Réservations', end: false },
  { to: '/admin/scan', label: 'Scanner', end: false },
  { to: '/admin/parametres', label: 'Paiements', end: false },
  { to: '/admin/emails', label: 'E-mails', end: false },
]

export function AdminLayout() {
  usePrivatePage()
  const { logout, role } = useAdminSession()
  const links = role === 'scanner' ? LINKS.filter((l) => l.to === '/admin/scan') : LINKS
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Aller au contenu
      </a>
      <header className="sticky top-0 z-30 border-b border-line/70 bg-cream/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white sm:inline">{role === 'scanner' ? 'Contrôle d’entrée' : 'Organisateur'}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout()
              navigate('/admin/login')
            }}
          >
            Se déconnecter
          </Button>
        </div>
        <nav aria-label="Administration" className="mx-auto max-w-6xl overflow-x-auto px-4 pb-2 sm:px-6">
          <ul className="flex gap-1">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    `inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold transition ${
                      isActive ? 'bg-ink text-white' : 'text-ink-soft hover:bg-brand-soft hover:text-brand-strong'
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="contenu" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
