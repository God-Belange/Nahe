import { Link, NavLink, Outlet } from 'react-router'
import { fr } from '../lib/fr'
import { Logo } from './Logo'

export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Aller au contenu
      </a>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <nav aria-label="Navigation principale">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `rounded-full px-4 py-2 text-sm font-semibold hover:bg-brand-soft ${isActive ? 'text-brand-strong' : 'text-ink-soft'}`
            }
          >
            {fr.nav.events}
          </NavLink>
        </nav>
      </header>
      <main id="contenu" className="flex-1" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="mt-16 border-t border-line/70 bg-paper/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            <span className="font-display font-bold text-ink">Nahe<span className="text-coral">?</span></span> — {fr.brand.slogan}
          </p>
          <nav aria-label="Pied de page" className="flex gap-5">
            <Link to="/confidentialite" className="font-medium underline-offset-4 hover:underline">{fr.nav.privacy}</Link>
            <Link to="/admin" className="font-medium underline-offset-4 hover:underline">{fr.nav.admin}</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
