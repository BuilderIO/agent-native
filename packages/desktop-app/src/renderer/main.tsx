import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.js";
import { initializeDesktopRendererSentry } from "./sentry.js";

import "./shell.css";
import "@agent-native/code-agents-ui/styles.css";

initializeDesktopRendererSentry();

// Apply platform class to body so CSS can adapt per OS
// (e.g. add padding for macOS traffic lights)
const platform = window.electronAPI?.platform ?? "unknown";
document.body.classList.add(`platform-${platform}`);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
