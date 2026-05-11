/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { readFileSync } from "node:fs";

// Estrae version da package.json — unica fonte di verità per backup payload
// e UI "Versione app". Evita drift tra pkg.json (es. "0.1.0") e hardcoded "1.0".
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8")) as { version: string };

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
        // Icone PWA — solo SVG scalable (nessun PNG placeholder per evitare
        // 404 silenti in produzione). Chrome ≥93 e Firefox ≥93 accettano SVG
        // come icona PWA. iOS ≥16 usa apple-touch-icon (vedi index.html).
        // Se serve target Android <10 o Chrome legacy: generare PNG 192/512
        // con tool esterno (es. https://realfavicongenerator.net) e aggiungere
        // qui entry dedicate + file binari in public/icons/.
        icons: [
          { src: "favicon.svg", sizes: "192x192 512x512", type: "image/svg+xml", purpose: "any" },
          { src: "favicon.svg", sizes: "192x192 512x512", type: "image/svg+xml", purpose: "maskable" }
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
  },
  // Wave 4.3+ — Configurazione vitest:
  //   - environment: "jsdom" → abilita test UI con DOM (RTL, screen.getByText,
  //     matchers @testing-library/jest-dom). Retrocompatibile con i test
  //     Node-only esistenti (es. equipmentSubstitutor.test.ts) perché jsdom
  //     espone window/document ma non interferisce con logica pura.
  //   - globals: true → describe/it/expect senza import esplicito (allinea
  //     allo stile dei test esistenti che già fanno import { describe, it,
  //     expect } esplicito; non rompe perché gli import overridano i globals).
  //   - setupFiles: registra matchers RTL e cleanup automatico DOM tra test.
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
