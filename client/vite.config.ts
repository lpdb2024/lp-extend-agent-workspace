import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';

// Dev parity with the prod server's route map:
//   /                  → developer landing page (served by Express; proxied below)
//   /agent-workspace*  → the console SPA (index.html, Vite's default)
//   /widget*           → the widget HTML entry (rewritten here)
//   /demo              → widget embed sample (served by Express; proxied below)
function devRoutes(): Plugin {
  return {
    name: 'acw-dev-routes',
    configureServer(server) {
      server.middlewares.use((req: { url?: string }, _res: unknown, next: () => void) => {
        if (req.url && /^\/widget(\/|\?|$)/.test(req.url) && !req.url.startsWith('/widget.html')) {
          const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
          req.url = '/widget.html' + q;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [vue(), tailwind(), devRoutes()],
  // Two entry points: the full console (index.html) and the embeddable widget
  // (widget.html). spa appType so unknown paths (e.g. /callback) fall back to
  // index.html; the widget is explicitly served at /widget.html.
  appType: 'spa',
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        widget: './widget.html',
      },
    },
  },
  server: {
    // 9400 so the SSO callback origin is http://localhost:9400/callback,
    // which is the redirect URI registered in the LP OAuth app.
    port: 9400,
    strictPort: true,
    proxy: {
      // Dev: proxy API + SSE to the Express server (keeps cookies same-origin).
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true, // forward WebSocket upgrades (cobrowse room screen stream)
      },
      // The landing (/) and the widget embed sample (/demo) are static pages served
      // by Express. Proxy them so the dev origin matches prod. (The console SPA lives
      // at /agent-workspace, which Vite serves as index.html via its SPA fallback.)
      '/demo': { target: 'http://localhost:8787', changeOrigin: true },
      '^/$': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
