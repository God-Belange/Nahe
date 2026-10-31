import { pbkdf2Sync } from 'node:crypto'
import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'drizzle'))

const TEST_ADMIN_PASSWORD = 'mot-de-passe-de-test'
const salt = Buffer.from('0123456789abcdef')
const hash = pbkdf2Sync(TEST_ADMIN_PASSWORD, salt, 1000, 32, 'sha256')
const hashOf = (password: string) =>
  `pbkdf2-sha256$1000$${salt.toString('base64')}$${pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('base64')}`
const adminPasswordHash = `pbkdf2-sha256$1000$${salt.toString('base64')}$${hash.toString('base64')}`
const scannerPasswordHash = hashOf('code-entree-de-test')

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './worker/index.ts',
      miniflare: {
        compatibilityDate: '2026-10-15',
        d1Databases: ['DB'],
        bindings: {
          ADMIN_PASSWORD_HASH: adminPasswordHash,
          SCANNER_PASSWORD_HASH: scannerPasswordHash,
          SESSION_SECRET: 'secret-de-test-uniquement-0123456789',
          BREVO_API_KEY: 'cle-brevo-de-test',
          MAIL_FROM_EMAIL: 'billets@nahe.test',
          MAIL_FROM_NAME: 'Nahe test',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
})
