// Mini markdown renderer (Sprint 4.3, 2026-05-26).
// Supporta: headers, bold, italic, code blocks, inline code, lists, tables,
// links, line breaks. NO dangerouslySetInnerHTML — produce React elements
// direttamente da line-by-line parsing.

import { Fragment } from "react";

interface MarkdownLiteProps {
  text: string;
}

// ─── Inline parser (bold, italic, code, link) ─────────────────────────────

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(text.slice(lastIdx, m.index));
    }
    const token = m[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code key={key++} style={{
          padding: "1px 4px", background: "#0B0F1A",
          borderRadius: "3px", fontSize: "11px",
          fontFamily: "'JetBrains Mono', monospace",
        }}>{token.slice(1, -1)}</code>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("[")) {
      // [text](url)
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a key={key++} href={linkMatch[2]} target="_blank" rel="noreferrer" style={{ color: "#0891B2" }}>
            {linkMatch[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    }
    lastIdx = m.index + token.length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts;
}

// ─── Block parser ─────────────────────────────────────────────────────────

type Block =
  | { type: "h2" | "h3" | "h4"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "p"; text: string }
  | { type: "code"; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "blockquote"; text: string };

function parseBlocks(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Empty line
    if (line.trim() === "") { i++; continue; }

    // Headers
    if (/^###\s+/.test(line)) {
      blocks.push({ type: "h4", text: line.replace(/^###\s+/, "") });
      i++; continue;
    }
    if (/^##\s+/.test(line)) {
      blocks.push({ type: "h3", text: line.replace(/^##\s+/, "") });
      i++; continue;
    }
    if (/^#\s+/.test(line)) {
      blocks.push({ type: "h2", text: line.replace(/^#\s+/, "") });
      i++; continue;
    }

    // HR
    if (/^---+\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++; continue;
    }

    // Code block (```)
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        buf.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "blockquote", text: buf.join(" ") });
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && /^\|?\s*[-:]+\s*\|/.test(lines[i + 1])) {
      const header = line.split("|").map(c => c.trim()).filter(Boolean);
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        const cells = lines[i].split("|").map(c => c.trim()).filter((_, idx, arr) => {
          // Filter only the truly empty trailing/leading cells (from |a|b|)
          return idx > 0 || arr[0] !== "";
        });
        // Re-split to keep correct column count
        const rawCells = lines[i].split("|");
        if (rawCells[0].trim() === "") rawCells.shift();
        if (rawCells[rawCells.length - 1].trim() === "") rawCells.pop();
        rows.push(rawCells.map(c => c.trim()));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // Lists
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph (until empty line)
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}|---|```|>|\|)/.test(lines[i]) && !/^[-*+]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

// ─── React render ─────────────────────────────────────────────────────────

export default function MarkdownLite({ text }: MarkdownLiteProps) {
  const blocks = parseBlocks(text);
  return (
    <div style={{ color: "#E2E8F0", fontSize: "13px", lineHeight: 1.6 }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "h2":
            return <h2 key={i} style={{ fontSize: "18px", fontWeight: 800, color: "#E2E8F0", margin: "16px 0 8px" }}>{parseInline(b.text)}</h2>;
          case "h3":
            return <h3 key={i} style={{ fontSize: "15px", fontWeight: 700, color: "#E8553A", margin: "14px 0 6px" }}>{parseInline(b.text)}</h3>;
          case "h4":
            return <h4 key={i} style={{ fontSize: "13px", fontWeight: 700, color: "#0891B2", margin: "10px 0 4px" }}>{parseInline(b.text)}</h4>;
          case "hr":
            return <hr key={i} style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.1)", margin: "16px 0" }} />;
          case "p":
            return <p key={i} style={{ margin: "8px 0", color: "#CBD5E1" }}>{parseInline(b.text)}</p>;
          case "ul":
            return (
              <ul key={i} style={{ margin: "8px 0", paddingLeft: "20px", color: "#CBD5E1" }}>
                {b.items.map((it, j) => <li key={j} style={{ marginBottom: "4px" }}>{parseInline(it)}</li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} style={{ margin: "8px 0", paddingLeft: "20px", color: "#CBD5E1" }}>
                {b.items.map((it, j) => <li key={j} style={{ marginBottom: "4px" }}>{parseInline(it)}</li>)}
              </ol>
            );
          case "code":
            return (
              <pre key={i} style={{
                margin: "10px 0", padding: "10px 12px",
                background: "#0B0F1A", borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.06)",
                overflowX: "auto", fontSize: "11px", lineHeight: 1.5,
                fontFamily: "'JetBrains Mono', monospace", color: "#94A3B8",
              }}>{b.text}</pre>
            );
          case "blockquote":
            return (
              <blockquote key={i} style={{
                margin: "10px 0", padding: "8px 12px",
                background: "#16213E", borderLeft: "3px solid #0891B2",
                borderRadius: "0 8px 8px 0", fontStyle: "italic", color: "#94A3B8",
              }}>{parseInline(b.text)}</blockquote>
            );
          case "table":
            return (
              <div key={i} style={{ overflowX: "auto", margin: "10px 0" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={j} style={{
                          padding: "6px 8px", textAlign: "left",
                          background: "#16213E", color: "#E8553A",
                          fontWeight: 700, fontSize: "10px", textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          borderBottom: "1px solid rgba(255,255,255,0.12)",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} style={{
                            padding: "6px 8px",
                            color: "#CBD5E1",
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                          }}>{parseInline(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <Fragment key={i} />;
        }
      })}
    </div>
  );
}
