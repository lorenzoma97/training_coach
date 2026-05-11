// Wave Privacy — purge una-tantum della chat history pre-Wave Privacy.
//
// Contesto: prima di Wave Privacy i messaggi user venivano salvati RAW in
// `coach-chat-history` (localStorage). Quando l'utente li ri-manda al modello
// vengono ora sanitizzati (vedi CoachChat.send → sanitizePII), ma se l'utente
// scrolla indietro nella UI vede ancora il proprio testo originale (con email,
// telefono, CF, IBAN, URL eventualmente scritti nelle note).
//
// Soluzione: purge one-shot al primo mount post-aggiornamento. Itera i messaggi
// con role="user", applica sanitizePII al content e sostituisce in-place.
// Marca i messaggi modificati con `_piiPurgedAt` per audit (campo extra,
// non rompe la shape Msg = {id, role, content} consumata dal componente —
// il filtro in CoachChat.loadHistory ignora i campi extra).

import { getJSON, setJSON } from "../storage";
import { sanitizePII } from "../promptSanitizer";

const HISTORY_KEY = "coach-chat-history";

/**
 * Shape minima attesa per un messaggio in storage. Volutamente larga: NON
 * forziamo equality con il tipo Msg di CoachChat (loose contract per evitare
 * import circolare e per tollerare formati legacy con campi aggiuntivi).
 */
interface StoredMsg {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  // Campo opzionale aggiunto da questa migration (audit traccia).
  _piiPurgedAt?: string;
  // Tutto il resto (extra fields) viene preservato as-is.
  [key: string]: unknown;
}

export interface ChatHistoryPurgeReport {
  /** Quanti messaggi user sono stati modificati (PII trovata e redatta). */
  purged: number;
  /** Totale messaggi nella history (tutti i ruoli). */
  total: number;
}

/**
 * Esegue la purge PII sui messaggi user-side della chat history.
 *
 * Comportamento:
 *  - History assente / vuota / non-array → no-op, ritorna {0, 0}.
 *  - Storage corrotto (JSON non parseable) → getJSON usa fallback [], no-op
 *    silente. Mai throw verso il caller (non vogliamo bloccare il mount UI).
 *  - Per ogni messaggio role="user": confronta length(content) pre vs post
 *    sanitizePII. Se differiscono → marca purged + aggiunge `_piiPurgedAt`.
 *  - Messaggi role="model" o malformati: passano invariati.
 *  - Salvataggio: solo se almeno 1 messaggio è stato modificato (evita write
 *    inutile su history pulite). Eventuali errori di setJSON loggati ma non
 *    propagati: la migration è best-effort.
 *
 * Idempotente: una seconda chiamata su una history già purgata trova 0 diff
 * → 0 modifiche, 0 write.
 */
export async function purgeChatHistoryPII(): Promise<ChatHistoryPurgeReport> {
  let raw: unknown;
  try {
    raw = await getJSON<unknown>(HISTORY_KEY, []);
  } catch (e) {
    // getJSON già swallowa i parse error (vedi storage.ts), ma per paranoia.
    console.warn("[chatHistoryPurge] Lettura history fallita, skip:", e);
    return { purged: 0, total: 0 };
  }

  if (!Array.isArray(raw)) {
    // Shape inattesa (storage manomesso da altra tab o extension).
    return { purged: 0, total: 0 };
  }

  const messages = raw as StoredMsg[];
  let purgedCount = 0;
  const purgedAt = new Date().toISOString();

  const updated: StoredMsg[] = messages.map(m => {
    // Solo messaggi user con content stringa sono candidati.
    if (!m || typeof m !== "object") return m;
    if (m.role !== "user") return m;
    if (typeof m.content !== "string") return m;

    const before = m.content;
    const after = sanitizePII(before);
    if (after === before) {
      // Nessuna PII trovata → invariato.
      return m;
    }
    // PII trovata: redatto + traccia.
    purgedCount++;
    return { ...m, content: after, _piiPurgedAt: purgedAt };
  });

  if (purgedCount > 0) {
    try {
      await setJSON(HISTORY_KEY, updated);
    } catch (e) {
      // Quota / value-too-large: loggiamo ma non blocchiamo. La purge
      // ri-tentativa al prossimo mount NON avverrà perché il flag è
      // già settato dal caller; in pratica è un best-effort.
      console.warn("[chatHistoryPurge] Salvataggio history post-purge fallito:", e);
    }
  }

  return { purged: purgedCount, total: messages.length };
}
