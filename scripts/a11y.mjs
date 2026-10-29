// Audit d'accessibilité axe (WCAG 2 A/AA) des pages principales. Usage : node scripts/a11y.mjs [baseUrl]
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const base = process.argv[2] ?? 'http://localhost:5173'
const password = process.env.E2E_ADMIN_PASSWORD ?? 'nahe-dev-local-2026'

const browser = await chromium.launch({ executablePath: process.env.CI ? undefined : '/usr/bin/google-chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', reducedMotion: 'reduce' })
const page = await ctx.newPage()

async function audit(label, path) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.evaluate(axeSource)
  const result = await page.evaluate(() => globalThis.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }))
  const bad = result.violations
  console.log(`${bad.length === 0 ? '✓' : '✗'} ${label} (${result.passes.length} règles ok)`)
  for (const v of bad) console.log(`   - ${v.id} [${v.impact}] ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  return bad.length
}

let total = 0
for (const [l, p] of [
  ['accueil', '/'],
  ['événement', '/e/barbecue-de-la-rentree'],
  ['réservation', '/e/barbecue-de-la-rentree/reserver'],
  ['événement privé', '/i/seedtoken-anniv-00000000000000'],
  ['confidentialité', '/confidentialite'],
  ['connexion admin', '/admin/login'],
]) total += await audit(l, p)

await page.goto(base + '/admin/login')
await page.getByLabel('Mot de passe').fill(password)
await page.getByRole('button', { name: /Se connecter|Connexion/ }).click()
await page.waitForURL(/\/admin$/)
for (const [l, p] of [
  ['admin : tableau de bord', '/admin'],
  ['admin : événements', '/admin/evenements'],
  ['admin : nouvel événement', '/admin/evenements/nouveau'],
  ['admin : réservations', '/admin/reservations'],
  ['admin : paiements', '/admin/parametres'],
  ['admin : scanner', '/admin/scan?eventId=seed-anniv'],
]) total += await audit(l, p)

await browser.close()
process.exitCode = total === 0 ? 0 : 1
console.log(total === 0 ? 'A11Y OK' : `${total} page(s) avec violations`)
