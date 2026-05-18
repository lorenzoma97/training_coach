// Diagnostic logger per debug sotto-prescrizione (Lorenzo 2026-05-18).
// Cattura l'ultima generazione piano + retry + risultato e salva in
// localStorage per ispezione user-side da mobile (no DevTools native).
//
// UI: PlanDiagnosticPanel.tsx mostra il contenuto in SettingsPage con
// bottone "Copia tutto" per share via WhatsApp.

import { setJSON, getJSON } from "../storage";

const KEY = "plan-diagnostic-last";

export interface PlanDiagnostic {
  timestamp: string;
  mode: "initial" | "regen" | "adapt";
  prescription: {
    weeklyVolumeTargetMin: number;
    rangeMin: number;
    rangeMax: number;
    avgSessionMin: number;
    sessionRangeMin: number;
    sessionRangeMax: number;
    overrides: string[];
  };
  prompt: {
    systemInstructionLength: number;
    userPromptLength: number;
    maxTokens: number;
  };
  result: {
    actualVolumeMin: number;
    deltaPctVsTarget: number;
    sessionsCount: number;
    sessionsBreakdown: Array<{ day: string; type: string; duration_min: number }>;
    /** Primi 800 char della raw response Gemini (debug). */
    rawResponseSnippet: string;
  };
  retry?: {
    attempted: boolean;
    actualVolumeMin?: number;
    success?: boolean;
    error?: string;
  };
}

export async function saveDiagnostic(d: PlanDiagnostic): Promise<void> {
  try {
    await setJSON(KEY, d);
  } catch (e) {
    console.warn("[planDiagnostic] save failed:", e);
  }
}

export async function loadDiagnostic(): Promise<PlanDiagnostic | null> {
  return getJSON<PlanDiagnostic | null>(KEY, null);
}
