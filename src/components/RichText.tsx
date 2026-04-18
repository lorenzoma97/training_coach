// Renderer minimale per testo coach con **bold** inline. Nessuna dipendenza esterna.
//
// SICUREZZA — XSS defense-in-depth:
// Questo componente riceve testo generato da LLM (non fidato). React auto-escape
// già tutti i tag HTML quando si renderizza una stringa come child, quindi un
// input del tipo `<script>alert(1)</script>` o `<img onerror=...>` viene
// serializzato come testo letterale e NON eseguito.
//
// REGOLE DA RISPETTARE SEMPRE:
// 1. NON abilitare mai `dangerouslySetInnerHTML` qui — la sanitizzazione HTML
//    per input LLM non fidato è fragile (bypass noti via attributi SVG, data URI,
//    mutation XSS) e non vale la superficie d'attacco.
// 2. Se in futuro si aggiunge il rendering di link markdown `[text](url)`,
//    il parser DEVE accettare solo i protocolli `http:`, `https:`, `mailto:`
//    e rigettare/sostituire qualunque altro schema (in particolare `javascript:`,
//    `data:`, `vbscript:`, `file:`) — vedi `isSafeUrl` sotto come riferimento.
// 3. Mantenere il renderer a soli `text | **bold** | newline`: qualunque
//    estensione va valutata contro il rischio XSS.
import { Fragment } from "react";

/**
 * Whitelist di protocolli accettabili per eventuali URL. Definita qui come
 * riferimento: se il renderer verrà esteso a link markdown, USARE questa
 * funzione prima di passare `href` a un tag `<a>`. Un URL che non supera il
 * check va reso come testo letterale (o sostituito con `about:blank`).
 *
 * Nota: attualmente NON utilizzata perché non renderizziamo link — lasciata
 * volutamente come API interna documentata.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isSafeUrl(raw: string): boolean {
  try {
    // URL relativi senza schema (es. "/foo", "./bar") sono sicuri.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return true;
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}

export default function RichText({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, li) => (
        <Fragment key={li}>
          {renderLine(line)}
          {li < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </>
  );
}

function renderLine(line: string) {
  // Split su **...** mantenendo i match. Il risultato passa attraverso React
  // come stringa → auto-escape di tutti i caratteri HTML speciali.
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
