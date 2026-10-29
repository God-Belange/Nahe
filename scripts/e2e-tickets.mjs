// E2E billetterie : réservation de groupe → 3 billets → QR décodé → scan admin (lien et caméra simulée) → anti-doublon.
// Prérequis : `npm run dev` (pas de CSP en dev : le test rasterise des images blob), migrations + seed locaux.
// Usage : node scripts/e2e-tickets.mjs [baseUrl]
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const jsqrSource = readFileSync(require.resolve('jsqr/dist/jsQR.js'), 'utf8')
const base = process.argv[2] ?? 'http://localhost:5173'
const password = process.env.E2E_ADMIN_PASSWORD ?? 'nahe-dev-local-2026'
const shots = process.env.E2E_SHOTS ?? '/tmp/shots'
const email = `groupe-${Date.now().toString(36)}@example.com`
const step = (m) => console.log(`✓ ${m}`)
const executablePath = process.env.CI ? undefined : '/usr/bin/google-chrome'
const problems = []

async function decodeQr(page, locator) {
  const png = await locator.screenshot()
  await page.evaluate(jsqrSource)
  return page.evaluate(async (bytes) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height)
    const code = globalThis.jsQR(data, width, height)
    return { text: code?.data ?? null, width, height, luma: Array.from({ length: width * height }, (_, i) => data[i * 4]) }
  }, [...png])
}

// 1. Invité : réservation gratuite de 3 places
const browser = await chromium.launch({ executablePath, headless: true })
const guest = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' })).newPage()
guest.on('pageerror', (e) => problems.push(e.message))
await guest.goto(`${base}/i/seedtoken-anniv-00000000000000/reserver`)
await guest.getByLabel('Prénom').fill('Alex')
await guest.getByLabel(/^Nom/).fill('Groupe')
await guest.getByLabel('E-mail').fill(email)
await guest.getByRole('button', { name: 'Ajouter une place' }).click()
await guest.getByRole('button', { name: 'Ajouter une place' }).click()
await guest.getByRole('button', { name: /Réserver|Confirmer|Valider/ }).last().click()
await guest.waitForURL(/\/r\//)
await guest.getByText(/Billet 3 \/ 3/).first().waitFor()
const qrs = guest.locator('main svg[role="img"]')
assert.equal(await qrs.count(), 3, '3 QR codes affichés pour 3 places')
await guest.screenshot({ path: `${shots}/tickets-guest.png`, fullPage: true })
step('réservation de 3 places → 3 billets avec 3 QR codes')

// 2. Les QR sont réellement décodables et distincts
const hrefs = await guest.locator('a[href^="/t/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
assert.equal(new Set(hrefs).size, 3)
const decoded = []
for (let i = 0; i < 3; i++) decoded.push(await decodeQr(guest, qrs.nth(i)))
for (const [i, d] of decoded.entries()) {
  assert.ok(d.text, `QR ${i + 1} décodable`)
  assert.ok(d.text.startsWith(`${base}/admin/scan?t=`), d.text)
  assert.equal(decodeURIComponent(d.text.split('t=')[1]), hrefs[i].replace('/t/', ''))
}
assert.equal(new Set(decoded.map((d) => d.text)).size, 3)
step('les 3 QR codes se décodent et contiennent chacun leur propre jeton')

// Page billet individuelle
await guest.goto(base + hrefs[0])
await guest.getByText(/Billet 1 \/ 3/).first().waitFor()
await guest.screenshot({ path: `${shots}/tickets-page.png`, fullPage: true })
step('page billet /t/:token')

// 3. Organisateur : scan via lien (appareil photo natif)
const adminCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' })
const admin = await adminCtx.newPage()
admin.on('pageerror', (e) => problems.push(e.message))
await admin.goto(decoded[0].text)
await admin.waitForURL(/\/admin\/login\?next=/)
await admin.getByLabel('Mot de passe').fill(password)
await admin.getByRole('button', { name: /Se connecter|Connexion/ }).click()
await admin.waitForURL(/\/admin\/scan/)
await admin.getByText('Billet valide').first().waitFor()
await admin.screenshot({ path: `${shots}/scan-valid.png`, fullPage: true })
step('QR scanné hors connexion → login → retour sur le billet (valide, aucun effet de bord)')
await admin.getByRole('button', { name: "Valider l'entrée" }).click()
await admin.getByText('Entrée validée').first().waitFor()
await admin.screenshot({ path: `${shots}/scan-admitted.png`, fullPage: true })
step('entrée validée')
await admin.goto(decoded[0].text)
await admin.getByText(/Déjà utilisé/).first().waitFor()
await admin.screenshot({ path: `${shots}/scan-used.png`, fullPage: true })
step('second scan du même billet → « Déjà utilisé »')

// 4. Caméra simulée avec le billet 2 (flux vidéo factice contenant son QR)
const q = decoded[1]
const W = 640
const H = 480
const side = 420
const frame = Buffer.alloc(W * H * 3 / 2, 128)
frame.fill(235, 0, W * H)
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    const l = q.luma[Math.floor((y * q.height) / side) * q.width + Math.floor((x * q.width) / side)]
    frame[(30 + y) * W + 110 + x] = l < 128 ? 16 : 235
  }
}
const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`)
const frames = Array.from({ length: 30 }, () => Buffer.concat([Buffer.from('FRAME\n'), frame]))
writeFileSync('/tmp/qr-camera.y4m', Buffer.concat([header, ...frames]))

const camBrowser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=/tmp/qr-camera.y4m'],
})
const camCtx = await camBrowser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'], locale: 'fr-FR' })
const cam = await camCtx.newPage()
cam.on('pageerror', (e) => problems.push(e.message))
await cam.goto(`${base}/admin/login`)
await cam.getByLabel('Mot de passe').fill(password)
await cam.getByRole('button', { name: /Se connecter|Connexion/ }).click()
await cam.waitForURL(/\/admin$/)
await cam.goto(`${base}/admin/scan?eventId=seed-anniv`)
await cam.getByRole('button', { name: /Activer la caméra/ }).click()
await cam.getByText('Billet valide').first().waitFor({ timeout: 25000 })
await cam.getByText(/Billet 2 \/ 3/).first().waitFor()
await cam.screenshot({ path: `${shots}/scan-camera.png`, fullPage: true })
step('scan par la caméra : billet 2 / 3 reconnu')
await cam.getByRole('button', { name: "Valider l'entrée" }).click()
await cam.getByText('Entrée validée').first().waitFor()
step('entrée du billet 2 validée via la caméra')

// 5. Compteur et liste de repli, renvoi d'e-mail non configuré
await admin.goto(`${base}/admin/scan?eventId=seed-anniv`)
await admin.waitForFunction(() => {
  const m = /(\d+)\s*\/\s*(\d+)\s+entrés \/ attendus/.exec(document.querySelector('main')?.innerText ?? '')
  return m && Number(m[1]) >= 2 && Number(m[2]) >= 3 && Number(m[1]) <= Number(m[2])
})
step('compteur « entrés / attendus » cohérent (≥ 2 entrés sur ≥ 3 attendus)')
await admin.goto(`${base}/admin/reservations?q=${encodeURIComponent('Groupe')}`)
await admin.getByText('Billets non envoyés').first().waitFor()
await admin.getByRole('button', { name: 'Renvoyer les billets' }).first().click()
await admin.getByText(/non configuré/i).first().waitFor()
await admin.screenshot({ path: `${shots}/admin-resend.png`, fullPage: true })
step('renvoi sans clé Brevo : message explicite, rien ne casse')

await camBrowser.close()
await browser.close()
if (problems.length) {
  console.log('Erreurs de page :\n' + problems.join('\n'))
  process.exitCode = 1
} else console.log('E2E BILLETTERIE OK')
