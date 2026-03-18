import { reactRouter } from '@react-router/dev/vite';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number.parseInt(env.FRONTEND_PORT ?? '3000', 10);
  const apiBaseUrl = (env.VITE_API_BASE_URL ?? '/api').trim() || '/api';
  const proxyTarget = (env.FRONTEND_API_PROXY_TARGET ?? 'http://localhost:8080').trim();

  const proxy: Record<string, string | ProxyOptions> = {};
  if (apiBaseUrl.startsWith('/')) {
    proxy[apiBaseUrl] = {
      target: proxyTarget,
      changeOrigin: true,
      rewrite: (path) => path.replace(new RegExp(`^${escapeRegExp(apiBaseUrl)}`), ''),
    };
  }

  return {
    plugins: [
      reactRouter(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Leftover Label Printer',
          short_name: 'Leftover Labels',
          description: 'A phone-friendly print workflow for kitchen leftover labels.',
          theme_color: '#f97316',
          background_color: '#f6efe6',
          display: 'standalone',
          start_url: '/app/print/new',
          scope: '/',
          icons: [
            {
              src: '/icons/icon-192.svg',
              sizes: '192x192',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/icons/icon-512.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/icons/icon-maskable.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: '/index.html',
          runtimeCaching: [],
        },
      }),
    ],
    server: {
      host: '0.0.0.0',
      port,
      proxy,
    },
    preview: {
      host: '0.0.0.0',
      port,
    },
    test: {
      environment: 'jsdom',
    },
  };
});
