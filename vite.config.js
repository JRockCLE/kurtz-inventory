import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// Two entry points:
//   /index.html  → main Kurtz Inventory app (top nav, receiving, items, etc.)
//   /scans.html  → standalone Scan Hub PWA (installable on its own)
// Each has its own manifest, so each can be installed to desktop / taskbar as
// a separate app with its own icon.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        scans: resolve(__dirname, 'scans.html'),
      },
    },
  },
})
