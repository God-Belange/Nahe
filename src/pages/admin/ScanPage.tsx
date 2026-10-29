import jsQR from 'jsqr'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import type {
  AdminEvent,
  EventTicketRow,
  EventTickets,
  ScanOutcome,
  ScanResult,
} from '../../../shared/types'
import { PageHeader } from '../../components/admin/PageHeader'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { SelectField, TextField } from '../../components/ui/Field'
import { Alert, ErrorState, Skeleton } from '../../components/ui/feedback'
import { useToast } from '../../components/ui/Toast'
import { useAsync } from '../../hooks/useAsync'
import { useDocumentTitle } from '../../hooks/usePage'
import { api, errorMessage } from '../../lib/api'
import { formatShortDate, formatTime } from '../../lib/format'

/* ------------------------------ utilitaires ------------------------------ */

/** Le QR contient une URL …/admin/scan?t=<jeton> ; un texte brut est considéré comme le jeton lui-même. */
function extractToken(text: string): string {
  const trimmed = text.trim()
  try {
    const t = new URL(trimmed).searchParams.get('t')
    if (t) return t
  } catch {
    /* pas une URL : jeton brut */
  }
  return trimmed
}

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike

const AUTO_KEY = 'nahe.scan.auto'
const DEBOUNCE_MS = 3000
const AUTO_RESET_MS = 2500

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1'
  } catch {
    return false
  }
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'result'; token: string; outcome: ScanOutcome }

type CameraState = 'off' | 'starting' | 'on'

/* --------------------------------- page --------------------------------- */

export default function ScanPage() {
  useDocumentTitle("Contrôle d'entrée")
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const paramEventId = params.get('eventId')
  const paramToken = params.get('t')

  const events = useAsync(() => api.get<AdminEvent[]>('/admin/events'), [])
  const [chosenEventId, setChosenEventId] = useState<string | null>(null)

  const defaultEventId = useMemo(() => {
    const list = events.data ?? []
    const now = new Date().toISOString()
    const upcoming = list
      .filter((e) => e.status === 'published' && e.startsAt > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    return upcoming[0]?.id ?? list.find((e) => e.status === 'published')?.id ?? list[0]?.id ?? ''
  }, [events.data])
  const selectedId = chosenEventId ?? paramEventId ?? defaultEventId
  const selectedEvent = events.data?.find((e) => e.id === selectedId)

  const attendance = useAsync<EventTickets | undefined>(
    () => (selectedId ? api.get<EventTickets>(`/admin/events/${selectedId}/tickets`) : Promise.resolve(undefined)),
    [selectedId],
  )

  const [phase, setPhaseState] = useState<Phase>({ kind: 'idle' })
  const phaseRef = useRef<Phase>({ kind: 'idle' })
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  const [auto, setAuto] = useState(readAuto)
  const autoRef = useRef(auto)
  useEffect(() => {
    autoRef.current = auto
    try {
      localStorage.setItem(AUTO_KEY, auto ? '1' : '0')
    } catch {
      /* stockage indisponible */
    }
  }, [auto])

  const reloadAttendance = attendance.reload

  const vibrate = (pattern: number | number[]) => {
    if ('vibrate' in navigator) navigator.vibrate(pattern)
  }

  const checkIn = useCallback(
    async (token: string) => {
      setPhase({ kind: 'busy', label: "Validation de l'entrée…" })
      try {
        const outcome = await api.post<ScanOutcome>('/admin/tickets/check-in', {
          token,
          ...(selectedId ? { eventId: selectedId } : {}),
        })
        vibrate(outcome.result === 'admitted' ? 200 : [120, 80, 120])
        setPhase({ kind: 'result', token, outcome })
        reloadAttendance()
      } catch (err) {
        toast.show(errorMessage(err), 'bad')
        setPhase({ kind: 'idle' })
      }
    },
    [selectedId, reloadAttendance, setPhase, toast],
  )

  /** Étape 1 : consultation sans effet de bord ; l'entrée n'est validée qu'à l'étape 2. */
  const lookup = useCallback(
    async (token: string, options: { adoptEvent?: boolean } = {}) => {
      setPhase({ kind: 'busy', label: 'Vérification du billet…' })
      try {
        const qs = new URLSearchParams({ t: token })
        // Arrivée par un QR (appareil photo natif) : on ne filtre pas, on adopte l'événement du billet.
        if (selectedId && !options.adoptEvent) qs.set('eventId', selectedId)
        const outcome = await api.get<ScanOutcome>(`/admin/tickets/lookup?${qs.toString()}`)
        if (options.adoptEvent && outcome.ticket && outcome.ticket.eventId !== selectedId) {
          setChosenEventId(outcome.ticket.eventId)
        }
        if (outcome.result === 'ok' && autoRef.current) {
          await checkIn(token)
          return
        }
        if (outcome.result !== 'ok') vibrate([120, 80, 120])
        setPhase({ kind: 'result', token, outcome })
      } catch (err) {
        toast.show(errorMessage(err), 'bad')
        setPhase({ kind: 'idle' })
      }
    },
    [selectedId, checkIn, setPhase, toast],
  )

  const reset = useCallback(() => setPhase({ kind: 'idle' }), [setPhase])

  // Arrivée par l'appareil photo natif : /admin/scan?t=… → consultation automatique (jamais de validation).
  const handledToken = useRef<string | null>(null)
  useEffect(() => {
    if (!paramToken || handledToken.current === paramToken) return
    if (events.loading && !events.data) return
    handledToken.current = paramToken
    const token = extractToken(paramToken)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('t')
        return next
      },
      { replace: true },
    )
    void lookup(token, { adoptEvent: true })
  }, [paramToken, events.loading, events.data, lookup, setParams])

  // Mode automatique : retour à l'écran de scan après une entrée validée.
  useEffect(() => {
    if (!auto || phase.kind !== 'result' || phase.outcome.result !== 'admitted') return
    const timer = setTimeout(reset, AUTO_RESET_MS)
    return () => clearTimeout(timer)
  }, [auto, phase, reset])

  /* ------------------------------ caméra ------------------------------ */

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastSeen = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const [camera, setCamera] = useState<CameraState>('off')
  const [cameraError, setCameraError] = useState<string>()

  const onDecodedRef = useRef<(text: string) => void>(() => undefined)
  useEffect(() => {
    onDecodedRef.current = (text: string) => {
      const now = Date.now()
      if (phaseRef.current.kind !== 'idle') return
      if (lastSeen.current.text === text && now - lastSeen.current.at < DEBOUNCE_MS) return
      lastSeen.current = { text, at: now }
      void lookup(extractToken(text))
    }
  })

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamera('off')
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  async function startCamera() {
    setCameraError(undefined)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("La caméra n'est disponible qu'en HTTPS. Utilisez la saisie manuelle ou la liste ci-dessous.")
      return
    }
    setCamera('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      video.srcObject = stream
      await video.play()
      setCamera('on')
      runLoop(video)
    } catch (err) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setCamera('off')
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setCameraError("Accès à la caméra refusé. Autorisez-la dans les réglages du navigateur, ou utilisez la saisie manuelle.")
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setCameraError('Aucune caméra détectée sur cet appareil. Utilisez la saisie manuelle ou la liste ci-dessous.')
      } else {
        setCameraError("Impossible de démarrer la caméra. Utilisez la saisie manuelle ou la liste ci-dessous.")
      }
    }
  }

  function runLoop(video: HTMLVideoElement) {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
    let detector: BarcodeDetectorLike | null = null
    try {
      detector = Detector ? new Detector({ formats: ['qr_code'] }) : null
    } catch {
      detector = null
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let last = 0
    let working = false

    const tick = async (time: number) => {
      if (!streamRef.current) return
      rafRef.current = requestAnimationFrame(tick)
      if (working || time - last < 150 || video.readyState < 2 || phaseRef.current.kind !== 'idle') return
      last = time
      working = true
      try {
        let text: string | undefined
        if (detector) {
          try {
            text = (await detector.detect(video))[0]?.rawValue
          } catch {
            detector = null
          }
        }
        if (!detector && !text && ctx && video.videoWidth > 0) {
          const scale = Math.min(1, 640 / video.videoWidth)
          const w = Math.round(video.videoWidth * scale)
          const h = Math.round(video.videoHeight * scale)
          canvas.width = w
          canvas.height = h
          ctx.drawImage(video, 0, 0, w, h)
          text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data
        }
        if (text) onDecodedRef.current(text)
      } finally {
        working = false
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  /* -------------------------- saisie manuelle -------------------------- */

  const [manual, setManual] = useState('')
  function onManualSubmit(e: FormEvent) {
    e.preventDefault()
    const token = extractToken(manual)
    if (!token) return
    setManual('')
    void lookup(token)
  }

  /* ------------------------------ actions ------------------------------ */

  async function undo(ticketId: string, fromList = false) {
    try {
      await api.post<ScanOutcome>(`/admin/tickets/${ticketId}/undo-check-in`)
      toast.show('Entrée annulée', 'info')
      reloadAttendance()
      if (!fromList) reset()
    } catch (err) {
      toast.show(errorMessage(err), 'bad')
    }
  }

  async function checkInRow(row: EventTicketRow) {
    try {
      const outcome = await api.post<ScanOutcome>(`/admin/tickets/${row.ticketId}/check-in`)
      if (outcome.result === 'admitted') {
        vibrate(200)
        toast.show(`Entrée validée : ${row.holderName} (${row.seq}/${row.total})`)
      } else {
        toast.show(RESULT_COPY[outcome.result].title, 'bad')
      }
      reloadAttendance()
    } catch (err) {
      toast.show(errorMessage(err), 'bad')
    }
  }

  function switchToTicketEvent(eventId: string, token: string) {
    setChosenEventId(eventId)
    setPhase({ kind: 'busy', label: 'Changement d’événement…' })
    // Le sélecteur prend effet au prochain rendu ; la consultation repart avec le bon événement.
    setTimeout(() => {
      void (async () => {
        try {
          const outcome = await api.get<ScanOutcome>(
            `/admin/tickets/lookup?${new URLSearchParams({ t: token, eventId }).toString()}`,
          )
          setPhase({ kind: 'result', token, outcome })
        } catch (err) {
          toast.show(errorMessage(err), 'bad')
          setPhase({ kind: 'idle' })
        }
      })()
    }, 0)
  }

  /* -------------------------------- rendu -------------------------------- */

  const data = attendance.data
  const progress = data && data.expected > 0 ? Math.round((data.checkedIn / data.expected) * 100) : 0

  return (
    <>
      <PageHeader title="Contrôle d'entrée" subtitle="Scannez le QR code de chaque billet : un billet ne passe qu'une seule fois." />

      <div className="mx-auto max-w-xl space-y-5">
        {events.error && !events.data && <ErrorState message={events.error.message} onRetry={events.reload} />}
        {events.loading && !events.data && <Skeleton className="h-24" />}

        {events.data && events.data.length === 0 && (
          <Alert tone="info">Aucun événement pour le moment : créez-en un pour émettre des billets.</Alert>
        )}

        {events.data && events.data.length > 0 && (
          <>
            <Card className="space-y-4">
              <SelectField label="Événement contrôlé" value={selectedId} onChange={(e) => setChosenEventId(e.target.value)}>
                {events.data.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} — {formatShortDate(ev.startsAt)}
                  </option>
                ))}
              </SelectField>
              <div role="status" aria-live="polite">
                {attendance.loading && !data ? (
                  <Skeleton className="h-16" />
                ) : data ? (
                  <>
                    <p className="text-4xl font-extrabold tracking-tight">
                      {data.checkedIn} <span className="text-xl font-bold text-ink-soft">/ {data.expected}</span>
                    </p>
                    <p className="text-sm font-semibold text-ink-soft">entrés / attendus{selectedEvent ? ` · ${selectedEvent.title}` : ''}</p>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                      <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </>
                ) : (
                  attendance.error && <p className="text-sm text-bad">Compteur indisponible : {attendance.error.message}</p>
                )}
              </div>
            </Card>

            {/* Résultat : zone annoncée aux lecteurs d'écran */}
            <div aria-live="assertive" role="status">
              {phase.kind === 'busy' && (
                <Card className="py-8 text-center text-lg font-semibold text-ink-soft">{phase.label}</Card>
              )}
              {phase.kind === 'result' && (
                <ResultCard
                  outcome={phase.outcome}
                  autoNext={auto && phase.outcome.result === 'admitted'}
                  onValidate={() => void checkIn(phase.token)}
                  onUndo={() => phase.outcome.ticket && void undo(phase.outcome.ticket.ticketId)}
                  onNext={reset}
                  onSwitchEvent={() =>
                    phase.outcome.ticket && switchToTicketEvent(phase.outcome.ticket.eventId, phase.token)
                  }
                />
              )}
            </div>

            <Card className="space-y-4">
              <div className="relative overflow-hidden rounded-2xl bg-ink" hidden={camera === 'off'}>
                <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full object-cover" aria-label="Aperçu de la caméra" />
                <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-3xl border-4 border-white/80" />
                {camera === 'on' && phase.kind !== 'idle' && (
                  <p className="absolute inset-x-0 bottom-0 bg-ink/80 px-3 py-2 text-center text-sm font-semibold text-white">
                    Scan en pause
                  </p>
                )}
              </div>
              {cameraError && <Alert tone="warn">{cameraError}</Alert>}
              {camera === 'off' || camera === 'starting' ? (
                <Button size="lg" fullWidth loading={camera === 'starting'} onClick={() => void startCamera()} className="min-h-14">
                  📷 Activer la caméra
                </Button>
              ) : (
                <Button variant="secondary" fullWidth onClick={stopCamera} className="min-h-12">
                  Désactiver la caméra
                </Button>
              )}

              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => setAuto(e.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-semibold">Valider automatiquement les billets valides</span>
                  <span className="block text-ink-muted">Pratique en cas de file d'attente : l'entrée est enregistrée dès le scan.</span>
                </span>
              </label>

              <form onSubmit={onManualSubmit} className="flex items-end gap-2">
                <TextField
                  className="flex-1"
                  label="Code du billet"
                  hint="Collez le code ou le lien du QR code si la caméra ne lit pas."
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <Button type="submit" variant="secondary" disabled={manual.trim() === ''} className="mb-[1.35rem] min-h-11">
                  Vérifier
                </Button>
              </form>
            </Card>

            <TicketList
              data={data}
              loading={attendance.loading}
              onCheckIn={(row) => void checkInRow(row)}
              onUndo={(row) => void undo(row.ticketId, true)}
            />
          </>
        )}
      </div>
    </>
  )
}

/* ------------------------------ résultats ------------------------------ */

type Tone = 'ok' | 'used' | 'bad'
const RESULT_COPY: Record<ScanResult, { icon: string; title: string; tone: Tone }> = {
  ok: { icon: '✓', title: 'Billet valide', tone: 'ok' },
  admitted: { icon: '✓', title: 'Entrée validée', tone: 'ok' },
  already_used: { icon: '⚠', title: 'Billet déjà utilisé', tone: 'used' },
  void: { icon: '✕', title: 'Billet annulé', tone: 'bad' },
  wrong_event: { icon: '✕', title: "Billet d'un autre événement", tone: 'bad' },
  event_cancelled: { icon: '✕', title: 'Événement annulé', tone: 'bad' },
  invalid: { icon: '✕', title: 'QR code invalide', tone: 'bad' },
}

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'border-ok bg-ok-soft text-ok',
  used: 'border-warn bg-warn-soft text-warn',
  bad: 'border-bad bg-bad-soft text-bad',
}

interface ResultCardProps {
  outcome: ScanOutcome
  autoNext: boolean
  onValidate: () => void
  onUndo: () => void
  onNext: () => void
  onSwitchEvent: () => void
}

function ResultCard({ outcome, autoNext, onValidate, onUndo, onNext, onSwitchEvent }: ResultCardProps) {
  const { result, ticket } = outcome
  const copy = RESULT_COPY[result]
  let detail: ReactNode = null
  if (result === 'already_used' && ticket?.checkedInAt) {
    detail = `Déjà utilisé le ${formatShortDate(ticket.checkedInAt)} à ${formatTime(ticket.checkedInAt)}`
  } else if (result === 'wrong_event' && ticket) {
    detail = `Ce billet est pour « ${ticket.eventTitle} ».`
  } else if (result === 'void') {
    detail = 'Ce billet a été annulé : refusez l’entrée.'
  } else if (result === 'event_cancelled') {
    detail = 'Cet événement a été annulé : refusez l’entrée.'
  } else if (result === 'invalid') {
    detail = "Ce code n'est pas un billet Nahe valide ou a été falsifié."
  }

  return (
    <section
      aria-label="Résultat du scan"
      className={`animate-pop space-y-4 rounded-[var(--radius-card)] border-4 p-5 sm:p-6 ${TONE_CLASSES[copy.tone]}`}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-white text-3xl font-extrabold">
          {copy.icon}
        </span>
        <div>
          <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">{copy.title}</h2>
          {detail && <p className="mt-0.5 text-base font-semibold">{detail}</p>}
        </div>
      </div>

      {ticket && (
        <dl className="space-y-1 rounded-2xl bg-white/80 p-4 text-ink">
          <div>
            <dt className="sr-only">Titulaire</dt>
            <dd className="text-xl font-extrabold">{ticket.holderName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-4 text-sm font-semibold">
            <div><dt className="sr-only">Billet</dt><dd>Billet {ticket.seq} / {ticket.total}</dd></div>
            <div><dt className="sr-only">Référence</dt><dd className="font-mono">{ticket.reference}</dd></div>
          </div>
          <div className="text-sm text-ink-soft">
            <dt className="sr-only">Événement</dt>
            <dd>{ticket.eventTitle}</dd>
          </div>
        </dl>
      )}

      <div className="flex flex-col gap-2">
        {result === 'ok' && (
          <>
            <Button size="lg" fullWidth onClick={onValidate} className="min-h-14 !bg-ok text-lg hover:!brightness-90">
              Valider l'entrée
            </Button>
            <Button variant="secondary" fullWidth onClick={onNext} className="min-h-12">Annuler</Button>
          </>
        )}
        {result === 'admitted' && (
          <>
            {autoNext ? (
              <p className="text-center text-sm font-semibold">Retour au scan automatique…</p>
            ) : null}
            <Button size="lg" fullWidth onClick={onNext} className="min-h-14">Scanner le suivant</Button>
            <Button variant="secondary" fullWidth onClick={onUndo} className="min-h-12">Annuler la validation</Button>
          </>
        )}
        {result === 'wrong_event' && ticket && (
          <Button size="lg" fullWidth onClick={onSwitchEvent} className="min-h-12">
            Contrôler « {ticket.eventTitle} »
          </Button>
        )}
        {result !== 'ok' && result !== 'admitted' && (
          <Button size="lg" variant={result === 'wrong_event' ? 'secondary' : 'primary'} fullWidth onClick={onNext} className="min-h-14">
            Scanner le suivant
          </Button>
        )}
      </div>
    </section>
  )
}

/* ------------------------- liste de repli (sans caméra) ------------------------- */

function stateBadge(row: EventTicketRow): { icon: string; text: string; cls: string } {
  if (row.state === 'used') {
    return { icon: '✓', text: `Entré à ${row.checkedInAt ? formatTime(row.checkedInAt) : '—'}`, cls: 'bg-ok-soft text-ok' }
  }
  if (row.state === 'void') return { icon: '✕', text: 'Annulé', cls: 'bg-bad-soft text-bad' }
  return { icon: '●', text: 'Valide', cls: 'bg-brand-soft text-brand-strong' }
}

function TicketList({
  data,
  loading,
  onCheckIn,
  onUndo,
}: {
  data: EventTickets | undefined
  loading: boolean
  onCheckIn: (row: EventTicketRow) => void
  onUndo: (row: EventTicketRow) => void
}) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const rows = (data?.items ?? []).filter(
    (r) => !needle || r.holderName.toLowerCase().includes(needle) || r.reference.toLowerCase().includes(needle),
  )

  return (
    <Card className="!p-0">
      <details className="group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-bold [&::-webkit-details-marker]:hidden">
          <span>Liste des billets{data ? ` (${data.items.length})` : ''}</span>
          <span aria-hidden="true" className="text-ink-muted transition group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-3 border-t border-line px-5 py-4">
          <p className="text-sm text-ink-soft">Repli sans caméra : validez un billet à la main après avoir vérifié l'identité.</p>
          <TextField label="Rechercher" type="search" placeholder="Nom ou référence" value={q} onChange={(e) => setQ(e.target.value)} />
          {loading && !data && <Skeleton className="h-16" />}
          {data && rows.length === 0 && (
            <p className="py-4 text-center text-sm text-ink-muted">
              {data.items.length === 0 ? 'Aucun billet émis pour cet événement (ils sont créés à la confirmation du paiement).' : 'Aucun résultat.'}
            </p>
          )}
          <ul className="divide-y divide-line/70">
            {rows.map((row) => {
              const badge = stateBadge(row)
              return (
                <li key={row.ticketId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{row.holderName}</p>
                    <p className="text-xs text-ink-muted">
                      Billet {row.seq} / {row.total} · <span className="font-mono">{row.reference}</span>
                    </p>
                    <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${badge.cls}`}>
                      <span aria-hidden="true">{badge.icon}</span> {badge.text}
                    </span>
                  </div>
                  {row.state === 'valid' && (
                    <Button size="md" onClick={() => onCheckIn(row)} aria-label={`Valider l'entrée de ${row.holderName}, billet ${row.seq} sur ${row.total}`}>
                      Valider
                    </Button>
                  )}
                  {row.state === 'used' && (
                    <Button size="md" variant="secondary" onClick={() => onUndo(row)} aria-label={`Annuler l'entrée de ${row.holderName}, billet ${row.seq} sur ${row.total}`}>
                      Annuler l'entrée
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </details>
    </Card>
  )
}
