// Skeleton (P2 redesign, 2026-06-11) — placeholder shimmer per il caricamento
// delle superfici-dati. Sostituisce gli spinner: la pagina "appare" con la sua
// struttura invece di un'attesa generica (sensazione di velocità).
export default function Skeleton({ height, width, style }: {
  height: number | string;
  width?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className="skeleton"
      style={{ height, width: width ?? "100%", ...style }}
    />
  );
}
