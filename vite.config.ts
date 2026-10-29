import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // Pas d'assets en data: URI : la CSP de production (public/_headers) ne les autorise pas.
  build: { assetsInlineLimit: 0 },
})
