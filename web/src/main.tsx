import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { queryClient } from "./lib/queryClient";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Register the service worker so the app satisfies PWA installability
// criteria (Add to Home Screen / standalone window). The worker itself is
// intentionally minimal, no offline caching, so registration failures are
// swallowed and never affect the app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ignore registration failures, the app works fine without it.
    });
  });
}
