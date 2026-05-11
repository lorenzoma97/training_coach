// Wave 4.3+ — Setup globale vitest per test UI con jsdom + React Testing Library.
//
// Cosa fa:
//   1. Registra i matchers di @testing-library/jest-dom (es. .toBeInTheDocument(),
//      .toHaveAttribute(), .toBeVisible()) sul global expect di vitest.
//   2. Cleanup automatico del DOM dopo ogni test → evita leak tra test
//      consecutivi (componenti renderizzati nel test precedente vengono
//      smontati prima del successivo).
//
// Caricato da vite.config.ts → test.setupFiles. Eseguito una volta per worker
// vitest prima di ogni file di test.
//
// NB: import "/vitest" sub-path → variante che registra i matchers sul expect
// di vitest (non quello di jest). Necessario per evitare TypeError "expect is
// not a function" in environment vitest.

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
