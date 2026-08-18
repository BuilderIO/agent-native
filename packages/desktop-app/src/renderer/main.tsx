import { configureTracking } from "@agent-native/core/client/analytics";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.js";
import QuickPromptOverlay from "./components/QuickPromptOverlay.js";
import { initRendererTheme } from "./lib/theme.js";
import { initializeDesktopRendererSentry } from "./sentry.js";

import "./shell.css";
import "@agent-native/code-agents-ui/styles.css";

initializeDesktopRendererSentry();
initRendererTheme();
(
  window as Window & { __AGENT_NATIVE_HOST_PLATFORM__?: string }
).__AGENT_NATIVE_HOST_PLATFORM__ = "electron";
configureTracking({ authSessionRefresh: false, llmConnectionStatus: false });

// Apply platform class to body so CSS can adapt per OS
// (e.g. add padding for macOS traffic lights)
const platform = window.electronAPI?.platform ?? "unknown";
document.body.classList.add(`platform-${platform}`);

const isQuickPromptSurface =
  new URLSearchParams(window.location.search).get("surface") === "quick-prompt";
if (isQuickPromptSurface) document.body.classList.add("quick-prompt-surface");

const quickPromptSurface = isQuickPromptSurface ? (
  <QuickPromptOverlay
    onDismiss={() => window.electronAPI.quickPrompt.dismiss()}
    onSubmit={async (prompt, attachments, cwd, modelSelection) => {
      const result = await window.electronAPI.quickPrompt.submit({
        prompt,
        ...(cwd ? { cwd } : {}),
        ...(modelSelection?.engine ? { engine: modelSelection.engine } : {}),
        ...(modelSelection?.model ? { model: modelSelection.model } : {}),
        ...(modelSelection?.effort ? { effort: modelSelection.effort } : {}),
        attachments,
      });
      if (!result.ok) {
        throw new Error(result.error ?? result.message);
      }
    }}
  />
) : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isQuickPromptSurface ? quickPromptSurface : <App />}
  </React.StrictMode>,
);
