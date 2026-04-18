import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: il SW si aggiorna in background e applica le modifiche al
      // prossimo load completo. Combinato con skipWaiting + clientsClaim sotto
      // (workbox), il nuovo SW prende il controllo IMMEDIATAMENTE dopo l'installazione:
      // l'utente vedrà la nuova versione al prossimo reload naturale della pagina,
      // senza dover installare manualmente. NON mostriamo una UI custom di
      // "update available" qui per non toccare App.tsx (fuori ownership).
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      includeAssets: ["favicon.svg", "offline.html"],
      manifest: {
        name: "Diario & Coach",
        short_name: "Diario",
        description: "Diario allenamento con coach AI (Gemini Flash)",
        theme_color: "#0B0F1A",
        background_color: "#0B0F1A",
        display: "standalone",
        orientation: "portrait",
        start_url: ".",
        scope: ".",
        // TODO(ops): generare icon-192.png e icon-512.png in public/icons/
        // (es. con vite-plugin-pwa-assets-generator oppure online SVG→PNG).
        // Senza questi PNG, Android/Chrome possono rifiutare l'installazione
        // su alcune versioni OS (requisito 192px + 512px maskable).
        // iOS ≥16 usa apple-touch-icon (vedi index.html) come fallback.
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico,woff2}"],
        // Forziamo il nuovo SW a prendere il controllo subito dopo l'install:
        //   - skipWaiting: salta la fase "waiting" (niente vecchio SW attivo in parallelo).
        //   - clientsClaim: il nuovo SW controlla i client aperti immediatamente.
        // Combinato con registerType: "autoUpdate", il reload naturale al prossimo
        // load farà partire la versione aggiornata senza interazione utente.
        skipWaiting: true,
        clientsClaim: true,
        // Pagina di fallback per le route SPA quando l'app è offline e la
        // navigazione fallisce. `public/offline.html` è statica (no JS) e
        // informa l'utente che può consultare il diario locale.
        navigateFallback: "/offline.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/generativelanguage\.googleapis\.com\/.*/,
            handler: "NetworkOnly"
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }
  }
});
