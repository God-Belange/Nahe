import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import { cx } from './ui/cx'

const QUIET_ZONE = 4

/** Un seul <path> : une ligne de rectangles par suite de modules sombres consécutifs. */
function buildPath(text: string): { path: string; size: number } {
  const qr = qrcode(0, 'M')
  qr.addData(text, 'Byte')
  qr.make()
  const count = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < count; row++) {
    let col = 0
    while (col < count) {
      if (!qr.isDark(row, col)) {
        col++
        continue
      }
      const start = col
      while (col < count && qr.isDark(row, col)) col++
      path += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${col - start}v1h-${col - start}z`
    }
  }
  return { path, size: count + QUIET_ZONE * 2 }
}

interface QrCodeProps {
  value: string
  label: string
  /** Largeur maximale (valeur CSS, ex. « 24rem »). */
  maxWidth?: string
  className?: string
}

export function QrCode({ value, label, maxWidth = '24rem', className }: QrCodeProps) {
  const { path, size } = useMemo(() => buildPath(value), [value])
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      style={{ width: '100%', maxWidth }}
      className={cx('block h-auto rounded-xl bg-white', className)}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
