import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// base: './' keeps every URL relative so the build works from any sub-folder
// (e.g. https://user.github.io/repo-name/) without reconfiguration.
export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'generateSW',
      manifest: {
        id: './',
        name: "Felt & Oak Hold'em",
        short_name: "Hold'em",
        description: "Offline Texas Hold'em on a real-looking poker table.",
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1a120c',
        theme_color: '#1a120c',
        categories: ['games'],
        icons: [
          { src: 'icons/icon-180.png', sizes: '180x180', type: 'image/png' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache EVERYTHING emitted by the build (JS chunks, workers, CSS, fonts, icons, html, manifest).
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,webp,woff,woff2,json,webmanifest,ico,txt}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        cacheId: 'felt-oak-holdem',
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  worker: { format: 'es' },
  build: {
    target: ['es2022', 'safari16'],
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
  },
  preview: { port: 4173, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
  },
} as any);
