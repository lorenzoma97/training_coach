import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

// Global error handlers: non bloccanti, solo log per debug.
// Catturiamo errori sincroni non gestiti e promise rejection mai caught:
// utili quando qualcosa sfugge ai try/catch applicativi o agli ErrorBoundary
// (es. listener async, timer, fetch fire-and-forget).
window.addEventListener("error", (e) => {
  console.error(
    "[window.error] Uncaught error",
    "\nmessage:", e.message,
    "\nsource:", e.filename, `${e.lineno}:${e.colno}`,
    "\nerror:", e.error,
  );
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("[window.unhandledrejection] Promise rejected without handler", e.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label="root">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
