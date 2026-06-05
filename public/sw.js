// Minimal service worker — exists primarily to qualify the page for PWA
// install. We intentionally do NOT cache aggressively because:
//   1. The app talks to live agents (localhost:7878) and live Supabase data.
//   2. Stale React bundles after a deploy are confusing to debug.
//
// A future revision can add precaching for the app shell + offline support
// for unprocessed scans, but for now: pass-through and let the network do
// its thing.

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',    () => { /* no-op pass-through */ });
