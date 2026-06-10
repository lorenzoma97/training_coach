import { useEffect, useState } from "react";

const DISMISS_KEY = "pwa-banner-dismissed";

type Platform = "ios" | "android" | "desktop" | "unknown";

/**
 * Auto-detect piattaforma via UA.
 *
 * - iOS Safari: include "iPhone"/"iPad" e NON è webview (no "CriOS"/"FxiOS").
 *   Su iOS solo Safari supporta "Aggiungi a Home" come PWA (Chrome iOS è
 *   WebKit wrapper ma non espone l'API).
 * - Android Chrome: include "Android" e emette beforeinstallprompt (gestito
 *   nel componente). Identifichiamo qui solo la piattaforma; l'effettiva
 *   capacità di install è verificata via evento.
 * - Desktop / altro: niente banner.
 *
 * UA-sniffing è fragile in generale ma in questo caso il flag corretto
 * (display-mode: standalone) ci protegge da false-positive quando l'app
 * è già installata.
 */
function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isIOSSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  if (isIOSSafari) return "ios";
  const isAndroid = /Android/i.test(ua);
  if (isAndroid) return "android";
  return "desktop";
}

/** True se l'app è già lanciata in standalone (PWA installata). */
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS espone navigator.standalone; gli altri usano matchMedia display-mode.
  const navStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  const mq = window.matchMedia?.("(display-mode: standalone)").matches === true;
  return navStandalone || mq;
}

/**
 * Banner install PWA.
 *
 * - iOS Safari: istruzioni statiche (l'API beforeinstallprompt NON è supportata).
 * - Android Chrome: ascolta beforeinstallprompt, mostra bottone "Installa app"
 *   che chiama .prompt(). Se l'utente nega o l'evento non arriva mai, niente banner.
 * - Desktop: nessun render (install desktop è di limitata utilità qui).
 * - App già installata (display-mode: standalone): nessun render.
 * - Dismiss persistito in localStorage (chiave `pwa-banner-dismissed`).
 *
 * No Tailwind: inline style coerente col resto del progetto.
 */
type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PwaInstallBanner() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [standalone, setStandalone] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BIPEvent | null>(null);

  useEffect(() => {
    // Init stato (client-side only, evita SSR-style mismatch).
    setPlatform(detectPlatform());
    setStandalone(isStandalone());
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* localStorage può fallire in private mode */
    }

    const onBIP = (e: Event) => {
      // Preveniamo il prompt automatico del browser così possiamo mostrarlo
      // quando l'utente clicca il nostro bottone (UX più chiara).
      e.preventDefault();
      setDeferredPrompt(e as BIPEvent);
    };
    const onInstalled = () => {
      // Quando l'app viene installata, nascondi banner permanentemente.
      setStandalone(true);
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      // Indipendentemente dall'outcome, l'evento è single-use → cleanup.
      setDeferredPrompt(null);
      if (outcome === "accepted") {
        // appinstalled handler farà il resto; dismiss in attesa.
        setDismissed(true);
        try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn("[PwaInstallBanner] prompt failed:", err);
      setDeferredPrompt(null);
    }
  };

  // Early returns:
  // - dismissed: utente ha cliccato X
  // - standalone: app già installata
  // - desktop/unknown: install meno utile, no banner
  // - android senza deferredPrompt: l'evento non è arrivato → niente bottone funzionante
  if (dismissed || standalone) return null;
  if (platform === "desktop" || platform === "unknown") return null;
  if (platform === "android" && !deferredPrompt) return null;

  const baseStyle: React.CSSProperties = {
    position: "fixed",
    // Sopra la bottom nav (~70px di altezza nominale + safe-area inset).
    bottom: "calc(76px + env(safe-area-inset-bottom, 0px))",
    left: "12px",
    right: "12px",
    zIndex: 55,
    background: "#16213E",
    border: "1px solid rgba(232, 85, 58, 0.4)",
    borderRadius: "14px",
    padding: "12px 14px",
    color: "#E2E8F0",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    maxWidth: "560px",
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "13px",
    lineHeight: 1.4,
  };

  // a11y WCAG 2.5.5 — touch target min 44x44px su tutti i bottoni interattivi
  const closeBtn: React.CSSProperties = {
    background: "transparent",
    border: "none",
    // #CBD5E1 (slate-300) su #16213E → contrast ~9.5:1 (AAA), vs #94A3B8 ~5.2:1
    color: "#CBD5E1",
    fontSize: "22px",
    cursor: "pointer",
    padding: "10px 14px",
    marginLeft: "auto",
    lineHeight: 1,
    minHeight: "44px",
    minWidth: "44px",
  };

  const installBtn: React.CSSProperties = {
    padding: "12px 18px",
    background: "linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)",
    border: "none",
    borderRadius: "8px",
    color: "#FFF",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    minHeight: "44px",
    whiteSpace: "nowrap",
  };

  // Secondary text style: #CBD5E1 (slate-300) per contrast >= 7:1 su #16213E (AAA)
  const secondaryText: React.CSSProperties = { color: "#CBD5E1", fontSize: "13px" };

  if (platform === "ios") {
    // role="region" + aria-label rende il banner un landmark navigabile
    // (NON role="dialog": non c'è focus trap né è modale).
    return (
      <div role="region" aria-label="Installa Diario e Coach" style={baseStyle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: "2px", fontSize: "14px" }}>Installa l'app</div>
          <div style={secondaryText}>
            Tocca <b>Condividi</b> e poi <b>Aggiungi a Home</b>
          </div>
        </div>
        <button type="button" onClick={handleDismiss} aria-label="Chiudi banner installazione" style={closeBtn}>×</button>
      </div>
    );
  }

  // Android Chrome (con deferredPrompt disponibile)
  return (
    <div role="region" aria-label="Installa Diario e Coach" style={baseStyle}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: "2px", fontSize: "14px" }}>Installa l'app</div>
        <div style={secondaryText}>
          Apertura più rapida e icona sulla Home
        </div>
      </div>
      <button type="button" onClick={handleInstall} style={installBtn}>Installa app</button>
      <button type="button" onClick={handleDismiss} aria-label="Chiudi banner installazione" style={closeBtn}>×</button>
    </div>
  );
}
