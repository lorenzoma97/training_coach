// useModalBackButton (Sprint E, 2026-05-27).
//
// Integra i modali/overlay fullscreen col tasto "indietro" hardware (Android)
// e con la gesture back del browser. Senza questo, su Android premere indietro
// chiude l'intera PWA invece del modale aperto.
//
// Meccanica: quando un modale si apre, pushiamo un "sentinel" nella history.
// - Tasto indietro → popstate → chiudiamo il modale in cima allo stack.
// - Chiusura programmatica (X/backdrop) → rimuoviamo il sentinel con
//   history.back() sopprimendo il popstate risultante (no doppia chiusura).
//
// Gestisce modali ANNIDATI (es. ReferencesDrawer dentro ProgramView) via stack
// LIFO: il back chiude solo quello in cima, poi il successivo.

import { useEffect, useRef } from "react";

interface ModalEntry { close: () => void }

const modalStack: ModalEntry[] = [];
let suppressNextPop = false;
let listenerRegistered = false;

function onGlobalPop() {
  if (suppressNextPop) {
    // popstate causato da history.back() programmatico (chiusura via X) →
    // NON chiudere nulla: il sentinel è già stato rimosso.
    suppressNextPop = false;
    return;
  }
  // Tasto indietro reale → chiudi il modale in cima.
  const entry = modalStack.pop();
  if (entry) entry.close();
}

function ensureListener() {
  if (listenerRegistered || typeof window === "undefined") return;
  listenerRegistered = true;
  window.addEventListener("popstate", onGlobalPop);
}

/**
 * @param isOpen true quando il modale è montato/aperto. Se il componente è
 *   renderizzato condizionalmente (mount = open), passa semplicemente `true`.
 * @param onClose callback per chiudere il modale. Può essere ridefinita ad ogni
 *   render (usiamo un ref per evitare re-push spurii).
 */
export function useModalBackButton(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    ensureListener();
    const entry: ModalEntry = { close: () => onCloseRef.current() };
    modalStack.push(entry);
    window.history.pushState({ modal: true }, "");

    return () => {
      const idx = modalStack.indexOf(entry);
      if (idx >= 0) {
        // Chiusura NON via tasto indietro (X/backdrop/unmount programmatico):
        // rimuovi l'entry e consuma il sentinel pushato, sopprimendo il
        // popstate che history.back() genererà.
        modalStack.splice(idx, 1);
        suppressNextPop = true;
        window.history.back();
      }
      // Se idx < 0, l'entry è già stata rimossa da onGlobalPop (chiusura via
      // tasto indietro) → niente da fare.
    };
  }, [isOpen]);
}
