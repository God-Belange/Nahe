// Parcours E2E léger (Chrome + Playwright). Prérequis : `npm run dev` + migrations + seed locaux.
// Usage : E2E_ADMIN_PASSWORD=... node scripts/e2e.mjs [baseUrl]
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5173'
const password = process.env.E2E_ADMIN_PASSWORD ?? 'nahe-dev-local-2026'
const shots = process.env.E2E_SHOTS ?? '/tmp/shots'
const stamp = Date.now().toString(36)
const email = `e2e-${stamp}@example.com`

const browser = await chromium.launch({ executablePath: process.env.CI ? undefined : '/usr/bin/google-chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' })
const page = await ctx.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && !/status of (401|404)/.test(m.text()) && problems.push(`console: ${m.text()}`))
const step = (name) => console.log(`✓ ${name}`)

// 1. Invité : accueil → événement → réservation
await page.goto(base)
await page.locator('a[href^="/e/"]').first().click()
await page.waitForURL(/\/e\//)
await page.getByRole('link', { name: 'Je réserve ma place' }).first().click()
await page.waitForURL(/\/reserver/)
await page.getByLabel('Prénom').fill('Camille')
await page.getByLabel(/^Nom/).fill('Durand')
await page.getByLabel('E-mail').fill(email)
await page.getByLabel('Téléphone').fill('06 12 34 56 78')
await page.getByRole('button', { name: 'Ajouter une place' }).click()
await page.screenshot({ path: `${shots}/flow-book.png`, fullPage: true })
await page.getByRole('button', { name: /Réserver|Confirmer|Valider/ }).last().click()
await page.waitForURL(/\/r\//)
step('réservation créée, redirection vers le suivi')
const trackingUrl = page.url()
await page.getByText(/NAHE-[A-Z0-9]{6}/).first().waitFor()
const body = await page.locator('main').innerText()
const reference = /NAHE-[A-Z0-9]{6}/.exec(body)?.[0]
assert.ok(reference, 'référence affichée')
assert.match(body, /36,00/, 'montant 2 × 18 € affiché')
assert.match(body, /Wero/)
await page.screenshot({ path: `${shots}/flow-tracking.png`, fullPage: true })
step(`suivi : ${reference}, 36,00 €, instructions Wero`)

await page.getByRole('button', { name: "J'ai payé" }).click()
await page.getByText(/signalé/i).first().waitFor()
step('« J\'ai payé » signalé sans confirmer')

// 2. Un lien invalide
await page.goto(`${base}/r/lien-invalide`)
await page.getByText(/invalide|introuvable/i).first().waitFor()
step('lien de suivi invalide → message propre')

// 3. Admin
await page.goto(`${base}/admin`)
await page.waitForURL(/\/admin\/login/)
await page.getByLabel('Mot de passe').fill('mauvais')
await page.getByRole('button', { name: /Se connecter|Connexion/ }).click()
await page.getByRole('alert').first().waitFor()
step('mauvais mot de passe refusé')
await page.getByLabel('Mot de passe').fill(password)
await page.getByRole('button', { name: /Se connecter|Connexion/ }).click()
await page.waitForURL(/\/admin$/)
await page.getByText(/encaissé/i).first().waitFor()
await page.screenshot({ path: `${shots}/flow-dashboard.png`, fullPage: true })
step('connexion admin + tableau de bord')

await page.goto(`${base}/admin/reservations`)
await page.getByText(reference).first().waitFor()
assert.ok(await page.getByText(/Paiement déclaré/i).first().isVisible(), 'indicateur paiement déclaré')
await page.screenshot({ path: `${shots}/flow-reservations.png`, fullPage: true })
await page.getByRole('button', { name: 'Confirmer le paiement' }).first().click()
await page.getByRole('button', { name: 'Oui, paiement reçu' }).click()
await page.locator('span:text-is("Confirmée")').first().waitFor()
step('paiement confirmé manuellement')

await page.goto(trackingUrl)
await page.getByText(/Confirmée/).first().waitFor()
step('le suivi invité passe à « Confirmée »')

// 4. Création + publication d'un événement
await page.goto(`${base}/admin/evenements/nouveau`)
const title = `Soirée E2E ${stamp}`
await page.getByLabel(/Titre/).fill(title)
await page.getByLabel(/Lieu/).fill('Salle des fêtes, Lille')
await page.getByLabel(/Début/).fill('2027-03-20T20:00')
await page.getByLabel(/Prix/).fill('0')
await page.getByLabel(/Capacité/).fill('12')
await page.screenshot({ path: `${shots}/flow-eventform.png`, fullPage: true })
await page.getByRole('button', { name: /Créer|Enregistrer/ }).click()
await page.waitForURL(/\/admin\/evenements\/[^/]+$/)
await page.getByRole('button', { name: /^Publier/ }).click()
await page.getByRole('button', { name: /Publier|Confirmer/ }).last().click()
await page.getByText('Publié').first().waitFor()
step('événement gratuit créé et publié')
await page.screenshot({ path: `${shots}/flow-eventdetail.png`, fullPage: true })

await page.goto(base)
await page.getByText(title).first().waitFor()
step('événement visible sur l\'accueil')

// 5. Déconnexion
await page.goto(`${base}/admin`)
await page.getByRole('button', { name: 'Se déconnecter' }).click()
await page.waitForURL(/\/admin\/login/)
await page.goto(`${base}/admin/evenements`)
await page.waitForURL(/\/admin\/login/)
step('déconnexion et accès admin refusé')

await browser.close()
if (problems.length) {
  console.log('Problèmes console :\n' + problems.join('\n'))
  process.exitCode = 1
} else console.log('E2E OK')
