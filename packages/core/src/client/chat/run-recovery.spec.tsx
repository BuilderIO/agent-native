// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clipboardMock = vi.hoisted(() => ({
  writeClipboardText: vi.fn(),
}));

const agentEngineKeyMock = vi.hoisted(() => ({
  saveAgentEngineApiKey: vi.fn(),
  saveAgentEngineProviderSettings: vi.fn(),
  setAgentEngineProvider: vi.fn(),
}));

vi.mock("../clipboard.js", () => ({
  writeClipboardText: clipboardMock.writeClipboardText,
}));

vi.mock("../agent-engine-key.js", () => ({
  saveAgentEngineApiKey: agentEngineKeyMock.saveAgentEngineApiKey,
  saveAgentEngineProviderSettings:
    agentEngineKeyMock.saveAgentEngineProviderSettings,
  setAgentEngineProvider: agentEngineKeyMock.setAgentEngineProvider,
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
    agentEngineKeyMock.saveAgentEngineProviderSettings.mockReset();
    agentEngineKeyMock.setAgentEngineProvider.mockReset();
    agentEngineKeyMock.saveAgentEngineApiKey.mockResolvedValue(undefined);
    agentEngineKeyMock.saveAgentEngineProviderSettings.mockResolvedValue(
      undefined,
    );
    agentEngineKeyMock.setAgentEngineProvider.mockResolvedValue(undefined);
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

  it("shows the searchable provider setup while disclosing API keys", async () => {
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

    const apiKeyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Custom keys"),
    );
    expect(apiKeyButton).toBeDefined();

    await act(async () => {
      apiKeyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Custom keys");
    expect(container.textContent).toContain("Choose a provider");

    const providerButton = container.querySelector(
      'button[aria-label="Choose a provider"]',
    );
    await act(async () => {
      providerButton?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("OpenRouter");
    expect(document.body.textContent).toContain("Ollama");
  });

  it("keeps sidebar provider actions in a horizontal row", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <BuilderSetupContent layout="sidebar" />
        </AgentNativeI18nProvider>,
      );
    });

    const actions = container.querySelector(
      ".agent-builder-setup-card__actions",
    );
    expect(actions).not.toBeNull();
    expect(actions?.className).toContain("flex-row");
    expect(actions?.className).not.toContain("flex-col");
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
    expect(container.textContent).toContain("Custom keys");
    expect(container.textContent).toContain("Retry");
  });

  it("renders missing-provider errors as inline setup and retries on click", async () => {
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "No LLM provider is connected.",
              errorCode: "missing_credentials",
            }}
            onContinue={vi.fn()}
            onRetry={onRetry}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).not.toContain("The agent hit an error");
    expect(container.textContent).not.toContain(
      "No LLM provider is connected.",
    );
    expect(onRetry).not.toHaveBeenCalled();

    const addKeysButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Custom keys"),
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

    expect(
      agentEngineKeyMock.saveAgentEngineProviderSettings,
    ).toHaveBeenCalled();
    expect(container.textContent).toContain("Retry");
    expect(onRetry).not.toHaveBeenCalled();

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    await act(async () => {
      retryButton?.click();
      retryButton?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("routes structured provider-key errors to inline setup recovery", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "ANTHROPIC_API_KEY is not set",
              errorCode: "missing_credentials",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).not.toContain("The agent hit an error");
  });

  it("keeps invalid provider keys on the authentication recovery path", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "Invalid API key",
              errorCode: "authentication_error",
            }}
            onContinue={vi.fn()}
            onRetry={vi.fn()}
            onDismiss={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.textContent).toContain("The agent hit an error");
    expect(container.textContent).toContain("Connect Builder.io");
  });

  it("dismisses the recovery card after saving a provider key", async () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();

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
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
        </AgentNativeI18nProvider>,
      );
    });

    const addKeysButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Custom keys"),
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

    expect(
      agentEngineKeyMock.saveAgentEngineProviderSettings,
    ).toHaveBeenCalledWith({
      provider: "anthropic",
      key: "ANTHROPIC_API_KEY",
      apiKey: "sk-test",
      scope: "user",
    });
    expect(agentEngineKeyMock.setAgentEngineProvider).toHaveBeenCalledWith({
      provider: "anthropic",
      model: expect.any(String),
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
