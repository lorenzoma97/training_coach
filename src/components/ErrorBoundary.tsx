import React from "react";

interface Props {
  children: React.ReactNode;
  /** Fallback custom opzionale. Se non fornito, usa quello di default in italiano. */
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  /** Etichetta contesto (nome pagina/area) utile per debug nel log. */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

// Classe component perché React non espone ancora un hook equivalente per catchare
// errori di rendering dei figli. `componentDidCatch` riceve anche il componentStack.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log esplicito con stack e componentStack per facilitare il debug.
    // Non inoltriamo a servizi esterni: PWA privacy-first, log locale.
    console.error(
      `[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}] Rendering error caught`,
      "\nerror:", error,
      "\nstack:", error.stack,
      "\ncomponentStack:", errorInfo.componentStack,
    );
    this.setState({ errorInfo });
  }

  private reset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private reload = (): void => {
    window.location.reload();
  };

  private copyDetails = async (): Promise<void> => {
    const { error, errorInfo } = this.state;
    // Privacy: redigiamo URL (solo origin+path, no query/hash che potrebbero
    // contenere token/PII) e UserAgent (solo family/OS, niente versioni
    // dettagliate utili per fingerprinting).
    const redactedUrl = (() => {
      try {
        const u = new URL(window.location.href);
        return `${u.origin}${u.pathname}`;
      } catch { return "(redacted)"; }
    })();
    const uaFamily = (() => {
      const ua = navigator.userAgent || "";
      // Estraiamo solo token di alto livello (Chrome/Firefox/Safari/Edge + OS)
      const match = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)[\/\s]*\d+/i)?.[0] || "browser";
      const os = ua.match(/\(([^)]+)\)/)?.[1]?.split(";")[0]?.trim() || "os";
      return `${match} on ${os}`;
    })();
    const payload = [
      `Errore: ${error?.name || "Error"}: ${error?.message || "(no message)"}`,
      `Data: ${new Date().toISOString()}`,
      `URL (redatto): ${redactedUrl}`,
      `Browser: ${uaFamily}`,
      "",
      "Stack:",
      error?.stack || "(no stack)",
      "",
      "Component stack:",
      errorInfo?.componentStack || "(no component stack)",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      // Feedback minimale non invasivo: console + alert breve.
      console.info("[ErrorBoundary] Dettagli errore copiati negli appunti.");
      alert("Dettagli errore copiati negli appunti.");
    } catch (e) {
      console.warn("[ErrorBoundary] Copia negli appunti fallita:", e);
      alert("Copia negli appunti non riuscita. Vedi console per i dettagli.");
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { fallback } = this.props;
    if (fallback) {
      if (typeof fallback === "function") {
        return fallback(this.state.error || new Error("Unknown error"), this.reset);
      }
      return fallback;
    }

    return (
      <div role="alert" style={{
        padding: "24px",
        margin: "20px auto",
        maxWidth: "560px",
        background: "#1E1B2E",
        border: "1px solid #7F1D1D",
        borderRadius: "12px",
        color: "#E2E8F0",
        fontSize: "14px",
        lineHeight: 1.5,
      }}>
        <h2 style={{ margin: "0 0 12px", fontSize: "18px", color: "#FCA5A5" }}>
          ⚠ Qualcosa è andato storto.
        </h2>
        <p style={{ margin: "0 0 16px", color: "#CBD5E1" }}>
          Puoi ricaricare la pagina o tornare alla home.
        </p>
        {this.state.error?.message && (
          <pre style={{
            background: "#0F172A",
            padding: "10px 12px",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#F87171",
            overflow: "auto",
            margin: "0 0 16px",
            maxHeight: "140px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>{this.state.error.name}: {this.state.error.message}</pre>
        )}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={this.reload} style={{
            background: "#14B8A6", color: "#FFF", border: "none",
            borderRadius: "8px", padding: "10px 16px",
            fontSize: "14px", fontWeight: 700, cursor: "pointer",
          }}>Ricarica</button>
          <button onClick={this.copyDetails} style={{
            background: "transparent", color: "#CBD5E1",
            border: "1px solid #475569", borderRadius: "8px",
            padding: "10px 16px", fontSize: "14px", fontWeight: 600,
            cursor: "pointer",
          }}>Copia dettagli errore</button>
          <button onClick={this.reset} style={{
            background: "transparent", color: "#94A3B8",
            border: "1px solid #334155", borderRadius: "8px",
            padding: "10px 16px", fontSize: "14px", fontWeight: 600,
            cursor: "pointer",
          }}>Riprova</button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
