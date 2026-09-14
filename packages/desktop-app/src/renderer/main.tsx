import { configureTracking } from "@agent-native/core/client/analytics";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.js";
import QuickPromptOverlay from "./components/QuickPromptOverlay.js";
import { RendererErrorBoundary } from "./components/RendererErrorBoundary.js";
import { initRendererTheme } from "./lib/theme.js";
import { initializeDesktopRendererSentry } from "./sentry.js";

import "./shell.css";
import "@agent-native/code-agents-ui/styles.css";

initializeDesktopRendererSentry();
initRendererTheme();
(
  window as Window & { __AGENT_NATIVE_HOST_PLATFORM__?: string }
).__AGENT_NATIVE_HOST_PLATFORM__ = "electron";
configureTracking({
  authSessionRefresh: false,
  llmConnectionStatus: false,
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "desktop",
    template: "desktop",
  }),
});

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
    <RendererErrorBoundary>
      {/*
        The shell renders core client components directly rather than inside a
        webview, so they call useTranslation() here. Without a provider
        react-i18next hands back a fresh `t` on every render, which cascades
        through useT() into the composer's memoized adapters and re-fires
        effects keyed on them in a loop. Copy is unchanged either way — useT()
        falls back to the same English table when a key is missing.
      */}
      {/*
        persistPreference reads and writes the locale through origin-relative
        endpoints. The shell is served from file://, so those can only ever
        fail here — there is no hosted origin behind this window to persist to.
      */}
      <AgentNativeI18nProvider persistPreference={false}>
        {isQuickPromptSurface ? quickPromptSurface : <App />}
      </AgentNativeI18nProvider>
    </RendererErrorBoundary>
  </React.StrictMode>,
);
