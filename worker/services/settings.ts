import { eq } from 'drizzle-orm'
import type { PaymentSettings } from '../../shared/types'
import type { PaymentSettingsInput } from '../../shared/schemas'
import { parsePaypalMe } from '../../shared/paypal'
import { DEFAULT_PENDING_TTL_HOURS, type PaymentMethod } from '../../shared/constants'
import { paymentSettings } from '../db/schema'
import type { Db } from '../lib/db'

const SETTINGS_ID = 1

export async function getPaymentSettings(db: Db): Promise<PaymentSettings> {
  const row = await db.select().from(paymentSettings).where(eq(paymentSettings.id, SETTINGS_ID)).get()
  if (!row) {
    return {
      weroInstructions: '',
      weroQrImageUrl: null,
      paypalMeUrl: null,
      pendingTtlHours: DEFAULT_PENDING_TTL_HOURS,
      updatedAt: null,
    }
  }
  return {
    weroInstructions: row.weroInstructions,
    weroQrImageUrl: row.weroQrImageUrl,
    paypalMeUrl: row.paypalMeUrl,
    pendingTtlHours: row.pendingTtlHours,
    updatedAt: row.updatedAt,
  }
}

export async function savePaymentSettings(
  db: Db,
  input: PaymentSettingsInput,
  now: Date,
): Promise<PaymentSettings> {
  const values = {
    weroInstructions: input.weroInstructions,
    weroQrImageUrl: input.weroQrImageUrl,
    paypalMeUrl: input.paypalMeUrl,
    pendingTtlHours: input.pendingTtlHours,
    updatedAt: now.toISOString(),
  }
  await db
    .insert(paymentSettings)
    .values({ id: SETTINGS_ID, ...values })
    .onConflictDoUpdate({ target: paymentSettings.id, set: values })
  return getPaymentSettings(db)
}

export function availablePaymentMethods(settings: PaymentSettings): PaymentMethod[] {
  const methods: PaymentMethod[] = []
  if (settings.weroInstructions.trim() !== '' || settings.weroQrImageUrl) methods.push('wero')
  if (settings.paypalMeUrl && parsePaypalMe(settings.paypalMeUrl)) methods.push('paypal')
  return methods
}
