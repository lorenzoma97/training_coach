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
//    VALIDARE i protocolli con una whitelist (`http:`, `https:`, `mailto:`)
//    tramite regex/`URL()` prima di passare `href` a un tag `<a>`. Rigettare
//    qualunque altro schema (in particolare `javascript:`, `data:`,
//    `vbscript:`, `file:`) — un URL non valido va reso come testo letterale.
// 3. Mantenere il renderer a soli `text | **bold** | newline`: qualunque
//    estensione va valutata contro il rischio XSS.
import { Fragment } from "react";

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
