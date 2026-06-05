import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// Mirror Vercel's `cleanUrls: true` behavior in the Vite dev server so
// `http://localhost:5173/scans` loads `scans.html` exactly like production.
// Without this, dev users would have to type `/scans.html` while production
// users hit `/scans` — confusing and easy to miss when copy-pasting URLs.
const cleanUrlsDev = {
  name: 'clean-urls-dev',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url || ''
      const [path, qs] = url.split('?')
      const stripped = path.replace(/\/$/, '')
      if (stripped === '/scans') {
        req.url = '/scans.html' + (qs ? '?' + qs : '')
      }
      next()
    })
  },
}

// Two entry points:
//   /            → main Kurtz Inventory app (top nav, receiving, items, etc.)
//   /scans       → standalone Scan Hub PWA (installable on its own)
// Each has its own manifest, so each can be installed to desktop / taskbar
// as a separate app with its own icon.
export default defineConfig({
  plugins: [react(), tailwindcss(), cleanUrlsDev],
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        scans: resolve(__dirname, 'scans.html'),
      },
    },
  },
})
