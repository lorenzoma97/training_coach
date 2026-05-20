// Audio cues per Guided Player (Step C, 2026-05-20).
//
// Scopo: bip countdown durante il rest tra set/esercizi. Pattern Lorenzo:
// "metti anche i bip quando mancano 5/3/2/1 secondi, un bip al secondo".
//
// Tecnologia: Web Audio API (no dipendenze esterne, no file mp3 da caricare).
// Genera un beep sinusoidale puro programmatico → zero footprint.
//
// Notes:
// - AudioContext richiede user-gesture per inizializzare (mobile policy).
//   Il Player chiamerà `primeAudio()` al click "Inizia allenamento" così
//   l'audio è pronto per i bip successivi.
// - Mute opzionale via localStorage `audio-muted` boolean (utente può
//   spegnere dai Settings — TODO future).
// - Frequenze e durate: countdown low-freq (700Hz × 80ms) per 5/4/3, mid
//   (900Hz × 80ms) per 2/1, high (1200Hz × 150ms) "go" per 0.

let ctx: AudioContext | null = null;

/**
 * Inizializza l'AudioContext. Da chiamare in risposta a user-gesture
 * (click bottone) — altrimenti mobile browsers bloccano l'inizializzazione.
 * Idempotente: chiamate successive sono no-op.
 */
export function primeAudio(): void {
  if (ctx) return;
  try {
    // TS: webkitAudioContext fallback per Safari vecchi
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    ctx = new AC();
  } catch (e) {
    console.warn("[audio] Web Audio API non disponibile:", e);
  }
}

/** True se l'utente ha mutato l'audio dai settings. */
function isMuted(): boolean {
  try {
    return localStorage.getItem("audio-muted") === "true";
  } catch {
    return false;
  }
}

/**
 * Suona un singolo beep sinusoidale.
 * @param freq frequenza in Hz (440-1500 range musicale)
 * @param durationMs durata in millisecondi (50-300 range pratico)
 * @param volume 0.0-1.0, default 0.3 (non-aggressive)
 */
export function playBeep(freq = 880, durationMs = 100, volume = 0.3): void {
  if (isMuted()) return;
  if (!ctx) {
    // Last-chance prime: l'utente non ha cliccato ma cerchiamo di iniziarlo
    // comunque. Su mobile è probabile fallirà silenziosamente.
    primeAudio();
    if (!ctx) return;
  }
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.frequency.value = freq;
    oscillator.type = "sine";
    // Envelope: attack rapido (5ms) + sustain + release rapido (15ms).
    // Evita click/pop udibili all'inizio e alla fine del tono.
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.005);
    gain.gain.setValueAtTime(volume, now + (durationMs / 1000) - 0.015);
    gain.gain.linearRampToValueAtTime(0, now + (durationMs / 1000));
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + (durationMs / 1000));
  } catch (e) {
    console.warn("[audio.playBeep] failed:", e);
  }
}

/**
 * Beep countdown contestualizzato. Per `playCountdownBeep(3)` suona il
 * bip per "mancano 3 secondi". Per `playCountdownBeep(0)` suona il "go".
 */
export function playCountdownBeep(secondsLeft: number): void {
  if (secondsLeft >= 3 && secondsLeft <= 5) {
    playBeep(700, 80);
  } else if (secondsLeft === 1 || secondsLeft === 2) {
    playBeep(900, 80);
  } else if (secondsLeft === 0) {
    playBeep(1200, 150, 0.4);
  }
  // Altri valori → ignorato (no spam)
}

/** Beep di "task completato" — usato a fine sessione/warmup/cooldown. */
export function playCompletionBeep(): void {
  if (isMuted()) return;
  // Trill ascending: 600 → 900 → 1200 (richiama "task done")
  playBeep(600, 100);
  setTimeout(() => playBeep(900, 100), 110);
  setTimeout(() => playBeep(1200, 150, 0.4), 230);
}
