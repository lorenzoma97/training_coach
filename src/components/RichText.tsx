// Renderer minimale per testo coach con **bold** inline. Nessuna dipendenza esterna.
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
  // Split su **...** mantenendo i match
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
