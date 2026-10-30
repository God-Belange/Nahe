import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ApiClientError, api, errorMessage } from '../../lib/api'
import { prepareImage } from '../../lib/image'
import { Button } from '../ui/Button'
import { TextField } from '../ui/Field'
import { Spinner } from '../ui/feedback'

interface Props {
  value: string
  error?: string | undefined
  onChange: (url: string) => void
  label?: string
  previewAlt?: string
  square?: boolean
}

export function CoverImageField({ value, error, onChange, label = 'Image de couverture', previewAlt = "Aperçu de l'image de couverture", square = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string>()
  const [previewFailed, setPreviewFailed] = useState(false)
  const src = value.trim()
  const showPreview = (src.startsWith('/images/') || src.startsWith('/api/images/')) && !previewFailed

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadError(undefined)
    setUploading(true)
    try {
      let blob: Blob
      try {
        blob = await prepareImage(file)
      } catch {
        setUploadError("Cette image ne peut pas être lue. Choisissez une photo JPEG, PNG ou WebP.")
        return
      }
      const { url } = await api.upload<{ url: string }>('/admin/images', blob)
      setPreviewFailed(false)
      onChange(url)
    } catch (err) {
      setUploadError(err instanceof ApiClientError ? err.message : errorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-ink">
          {label} <span className="font-normal text-ink-muted">(facultatif)</span>
        </p>
        {showPreview && (
          <img
            src={src}
            alt={previewAlt}
            onError={() => setPreviewFailed(true)}
            className={square ? 'size-40 rounded-2xl border border-line bg-white object-contain p-2' : 'h-36 w-full rounded-2xl border border-line object-cover sm:w-64'}
          />
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onPick}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="soft" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <Spinner /> : '🖼️'} {src ? 'Changer l\'image' : 'Choisir une image'}
          </Button>
          {src && (
            <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => { setUploadError(undefined); onChange('') }}>
              Retirer
            </Button>
          )}
        </div>
        <p role="status" className="text-xs text-ink-muted">
          {uploading ? 'Envoi de la photo…' : 'Depuis la galerie ou l’appareil photo. Elle est réduite automatiquement avant l’envoi.'}
        </p>
        {(uploadError || error) && (
          <p role="alert" className="flex items-center gap-1 text-sm font-medium text-bad">⚠ {uploadError ?? error}</p>
        )}
        {previewFailed && src && <p className="text-sm text-warn">Aperçu indisponible : aucun fichier à cet emplacement.</p>}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-ink-soft">Ou utiliser un fichier du projet</summary>
        <div className="mt-2">
          <TextField
            label="Chemin de l'image"
            placeholder="/images/barbecue.jpg"
            value={value}
            onChange={(e) => { setPreviewFailed(false); onChange(e.target.value) }}
            hint="Fichier déposé dans public/images/ du dépôt puis redéployé, par exemple /images/barbecue.jpg."
          />
        </div>
      </details>
    </div>
  )
}
