import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Product Finder Pro',
        short_name: 'ProductFinder',
        description: 'Fast Telegram channel product search & price comparison',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // never cache API / Supabase calls – always fresh prices & stock
        navigateFallbackDenylist: [/^\/auth/, /^\/rest/],
        runtimeCaching: [],
      },
    }),
  ],
  build: { sourcemap: false, target: 'es2020' },
});
