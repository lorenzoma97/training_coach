import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { registerSW } from "virtual:pwa-register";
import { refreshCustomCache, loadCustomExercises } from "./lib/macroprogram/customCatalog";
import { events } from "./lib/events";
import "./styles.css";

// Fix C4 (Fase 1): carica la cache in-memory degli esercizi custom al boot.
// Prima veniva popolata SOLO al mount della sezione upload o dopo un import:
// a freddo lookupExerciseHybrid non risolveva gli id custom → la UI mostrava
// l'id grezzo al posto del nome e macroAdapter validava i diff a vuoto.
// lookupExerciseHybrid è sincrono nel render: se il primo paint avviene prima
// che il refresh async finisca, mostrerebbe ancora l'id grezzo. Per chiudere
// la finestra, dopo il refresh emettiamo plan:updated SOLO se ci sono davvero
// esercizi custom → i consumer (TrainingPlanView/ProgramView) ri-renderizzano
// coi nomi risolti. Nessun custom → nessun emit, nessun lavoro inutile.
void (async () => {
  try {
    await refreshCustomCache();
    const customs = await loadCustomExercises();
    if (customs.length > 0) {
      events.emit("plan:updated", { at: new Date().toISOString() });
    }
  } catch (e) {
    console.warn("[main] refreshCustomCache al boot fallita:", e);
  }
})();

// Service Worker registration + update notification.
// vite-plugin-pwa emette `virtual:pwa-register` con callback:
// - onNeedRefresh: nuovo SW installato e in attesa. Prompt utente per reload.
// - onOfflineReady: app pronta per uso offline (primo install).
// Con skipWaiting+clientsClaim in vite.config, il SW prende controllo subito,
// ma avvisiamo comunque l'utente che c'è una nuova versione così sa perché
// l'app si aggiorna al prossimo reload.
const updateSW = registerSW({
  onNeedRefresh() {
    // Toast nativo: low-fi ma affidabile. Non serve sync con React state.
    // Il ritardo di 1.5s evita interruzioni se l'utente sta digitando.
    setTimeout(() => {
      const reload = confirm(
        "📦 Nuova versione dell'app disponibile.\n\nRicaricare ora per applicare gli aggiornamenti? (Le modifiche in corso saranno perse.)"
      );
      if (reload) updateSW(true);
    }, 1500);
  },
  onOfflineReady() {
    console.info("[PWA] App pronta per l'uso offline.");
  },
  onRegisterError(err) {
    console.warn("[PWA] Service Worker registration failed:", err);
  },
});

// Global error handlers: non bloccanti, solo log per debug.
// Catturiamo errori sincroni non gestiti e promise rejection mai caught:
// utili quando qualcosa sfugge ai try/catch applicativi o agli ErrorBoundary
// (es. listener async, timer, fetch fire-and-forget).
window.addEventListener("error", (e) => {
  console.error(
    "[window.error] Uncaught error",
    "\nmessage:", e.message,
    "\nsource:", e.filename, `${e.lineno}:${e.colno}`,
    "\nerror:", e.error,
  );
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("[window.unhandledrejection] Promise rejected without handler", e.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="root">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
