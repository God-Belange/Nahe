import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AdminLayout } from './components/AdminLayout'
import { PublicLayout } from './components/PublicLayout'
import { PageLoader } from './components/ui/feedback'
import { AdminGate, AdminSessionProvider } from './lib/admin-session'
import HomePage from './pages/public/HomePage'
import NotFoundPage from './pages/public/NotFoundPage'

const EventPage = lazy(() => import('./pages/public/EventPage'))
const BookingPage = lazy(() => import('./pages/public/BookingPage'))
const TrackingPage = lazy(() => import('./pages/public/TrackingPage'))
const PrivacyPage = lazy(() => import('./pages/public/PrivacyPage'))
const TicketPage = lazy(() => import('./pages/public/TicketPage'))

const LoginPage = lazy(() => import('./pages/admin/LoginPage'))
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'))
const EventsPage = lazy(() => import('./pages/admin/EventsPage'))
const EventFormPage = lazy(() => import('./pages/admin/EventFormPage'))
const ReservationsPage = lazy(() => import('./pages/admin/ReservationsPage'))
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'))
const ScanPage = lazy(() => import('./pages/admin/ScanPage'))

export function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="e/:slug" element={<EventPage mode="slug" />} />
          <Route path="e/:slug/reserver" element={<BookingPage mode="slug" />} />
          <Route path="i/:inviteToken" element={<EventPage mode="invite" />} />
          <Route path="i/:inviteToken/reserver" element={<BookingPage mode="invite" />} />
          <Route path="r/:accessToken" element={<TrackingPage />} />
          <Route path="t/:token" element={<TicketPage />} />
          <Route path="confidentialite" element={<PrivacyPage />} />
          <Route path="admin/login" element={<AdminSessionProvider><LoginPage /></AdminSessionProvider>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route
          path="admin"
          element={
            <AdminSessionProvider>
              <AdminGate />
            </AdminSessionProvider>
          }
        >
          <Route element={<AdminLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="evenements" element={<EventsPage />} />
            <Route path="evenements/nouveau" element={<EventFormPage />} />
            <Route path="evenements/:id" element={<EventFormPage />} />
            <Route path="reservations" element={<ReservationsPage />} />
            <Route path="scan" element={<ScanPage />} />
            <Route path="parametres" element={<SettingsPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
