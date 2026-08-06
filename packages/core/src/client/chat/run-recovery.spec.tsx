// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clipboardMock = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
}));

const agentEngineKeyMock = vi.hoisted(() => ({
  saveAgentEngineApiKey: vi.fn(),
}));

vi.mock("../clipboard.js", () => ({
  writeClipboardText: clipboardMock.writeClipboardText,
}));

vi.mock("../agent-engine-key.js", () => ({
  saveAgentEngineApiKey: agentEngineKeyMock.saveAgentEngineApiKey,
}));

vi.mock("../settings/useBuilderStatus.js", () => ({
  useBuilderConnectFlow: () => ({
    configured: false,
    connecting: false,
    error: null,
    hasFetchedStatus: true,
    start: vi.fn(),
  }),
}));

import { AgentNativeI18nProvider } from "../i18n.js";
import {
  BuilderSetupContent,
  LoopLimitContinueCard,
  RunErrorRecoveryCard,
} from "./run-recovery.js";

describe("run recovery surfaces", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    clipboardMock.writeClipboardText.mockReset();
    agentEngineKeyMock.saveAgentEngineApiKey.mockReset();
    agentEngineKeyMock.saveAgentEngineApiKey.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows an explicit failure state when Copy debug cannot write clipboard", async () => {
    clipboardMock.writeClipboardText.mockResolvedValue(false);

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message:
                "The model provider rejected the saved API key. Update the key in Settings → Integrations → API keys, then retry.",
              errorCode: "connection_error",
              runId: "run-123",
              details: "attempted_runs: run-1, run-2",
              recoverable: true,
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Debug-Informationen kopieren");
      expect(container.textContent).toContain(
        "Der Modellanbieter hat den gespeicherten API-Schlüssel abgelehnt.",
      );
    });
    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Debug-Informationen kopieren"),
    );

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(clipboardMock.writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("attempted_runs: run-1, run-2"),
    );
    expect(container.textContent).toContain("Kopieren fehlgeschlagen");
  });

  it("keeps the AI setup prompt icon-free while disclosing API keys", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <BuilderSetupContent />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).toContain("Connect Builder.io");
    expect(container.querySelector("svg")).toBeNull();

    const apiKeyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Add your own keys"),
    );
    expect(apiKeyButton).toBeDefined();

    await act(async () => {
      apiKeyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Add your own keys");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("formats the step limit with the selected locale", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <LoopLimitContinueCard
            info={{ maxIterations: 12_345 }}
            onContinue={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("12.345 Schritte");
    });
  });

  it("shows the AI setup flow and retry for a rejected provider key", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message:
                "The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
              errorCode: "authentication_error",
              details: '401 {"error":{"type":"authentication_error"}}',
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect Builder.io");
    expect(container.textContent).toContain("Add your own keys");
    expect(container.textContent).toContain("Retry");
  });

  it("dismisses the recovery card after saving a provider key", async () => {
    const onDismiss = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message:
                "The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
              errorCode: "authentication_error",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={onDismiss}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const addKeysButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Add your own keys"),
    );
    await act(async () => {
      addKeysButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    const inputSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      inputSetter?.call(input, "sk-test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save"),
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(agentEngineKeyMock.saveAgentEngineApiKey).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "sk-test",
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
