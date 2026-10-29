// Captures d'écran des pages principales (dev/prévisualisation). Usage : node scripts/shots.mjs [baseUrl] [dossier]
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:5173'
const out = process.argv[3] ?? '/tmp/shots'
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })
const pages = [
  ['home', '/'],
  ['event', '/e/barbecue-de-la-rentree'],
  ['book', '/e/barbecue-de-la-rentree/reserver'],
  ['invite', '/i/seedtoken-anniv-00000000000000'],
  ['privacy', '/confidentialite'],
  ['notfound', '/nimporte-quoi'],
  ['login', '/admin/login'],
]
for (const [label, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'fr-FR', timezoneId: 'Europe/Paris' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()))
  for (const [name, path] of pages) {
    await page.goto(base + path, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `${out}/${label}-${name}.png`, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (overflow) console.log('OVERFLOW', label, name)
  }
  await ctx.close()
}
await browser.close()
console.log('done')
