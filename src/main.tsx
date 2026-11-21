import { createRoot } from "react-dom/client";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import "./styles.brain.css";
import "./styles.control.css";
import App from "./App";
import { loadBenchScores } from "./lib/ai";

createRoot(document.getElementById("root")!).render(<App />);

// Real benchmark numbers, when the control daemon has them.
void loadBenchScores();

// The offline shell is a production nicety: it never runs in dev and never
// blocks startup if the browser refuses service workers.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Offline support is optional. */
    });
  });
}
