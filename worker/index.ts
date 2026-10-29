import { app } from './app'
import { runMaintenance } from './services/maintenance'

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runMaintenance(env, new Date()).then((report) =>
        console.log(`Maintenance quotidienne terminée (${report.anonymized} anonymisée(s)).`),
      ),
    )
  },
} satisfies ExportedHandler<Env>
