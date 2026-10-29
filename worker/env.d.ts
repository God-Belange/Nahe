declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./index')
  }
  interface Env {
    DB: D1Database
    ADMIN_PASSWORD_HASH: string
    SESSION_SECRET: string
    /** Facultatifs : sans eux, aucun e-mail de billets n'est envoyé. */
    BREVO_API_KEY?: string
    MAIL_FROM_EMAIL?: string
    MAIL_FROM_NAME?: string
    /** Uniquement injecté par la configuration Vitest. */
    TEST_MIGRATIONS?: import('@cloudflare/vitest-plugin').D1Migration[]
  }
}
interface Env extends Cloudflare.Env {}
