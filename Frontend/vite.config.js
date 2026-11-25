import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Product Finder Pro',
        short_name: 'ProductFinder',
        description: 'Fast Telegram Channel Product Search & Price Comparison',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/3081/3081559.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
});
