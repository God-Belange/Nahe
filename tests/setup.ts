import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, beforeEach } from 'vitest'
import { resetDatabase } from './helpers'
import { installMailMock } from './mail'

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? [])
})

beforeEach(async () => {
  installMailMock()
  await resetDatabase()
})
