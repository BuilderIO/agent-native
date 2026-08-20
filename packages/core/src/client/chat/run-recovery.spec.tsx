// @vitest-environment happy-dom

import React, { act } from "react";
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

const i18nMock = vi.hoisted(() => ({
  locale: "en-US",
}));

vi.mock("../i18n.js", () => ({
  AgentNativeI18nProvider: ({
    children,
    initialLocale,
  }: {
    children: React.ReactNode;
    initialLocale?: string;
  }) => {
    i18nMock.locale = initialLocale ?? "en-US";
    return React.createElement(React.Fragment, null, children);
  },
  useFormatters: () => ({
    formatNumber: (value: number) =>
      new Intl.NumberFormat(i18nMock.locale).format(value),
  }),
  useT: () => (key: string, options?: Record<string, unknown>) => {
    const translations: Record<string, Record<string, string>> = {
      "en-US": {
        "agentChat.setup.connectBuilder": "Connect Builder.io",
        "agentPanel.connectAi": "Connect AI",
        "agentPanel.builderOrOwnKeys": "Choose Builder.io or custom keys.",
        "agentPanel.addOwnKeys": "Custom keys",
        "agentChat.common.waiting": "Waiting",
        "agentChat.common.connect": "Connect",
        "agentChat.common.retry": "Retry",
        "agentChat.common.details": "Details",
        "agentChat.common.dismiss": "Dismiss",
        "agentChat.common.copied": "Copied",
        "agentChat.recovery.copyDebug": "Copy debug info",
        "agentChat.recovery.copyFailed": "Copy failed",
        "agentChat.recovery.credentialRejected":
          "The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
        "agentChat.recovery.newChatHint":
          "This run can be continued in a new chat.",
        "agentChat.recovery.reconnectBuilder": "Reconnect Builder.io",
        "agentChat.recovery.connectingBuilder": "Connecting Builder.io",
        "agentChat.error.stopped": "The agent stopped before finishing",
        "agentChat.error.failed": "The agent hit an error",
        "agentChat.limit.reached": "Step limit reached",
        "agentChat.limit.descriptionWithCount":
          "{{formattedCount}} steps remain for {{scope}}.",
        "agentChat.limit.descriptionAll": "More steps remain for {{scope}}.",
        "agentChat.limit.namedOrganization": "{{organization}}",
        "agentChat.limit.organization": "your organization",
        "agentChat.limit.account": "your account",
        "agentChat.limit.maxSteps": "Max steps",
        "agentChat.limit.saveAndContinue": "Save and continue",
        "agentChat.limit.keepGoing": "Keep going",
        "agentChat.limit.ownerOnly": "Only the owner can change this.",
        "agentChat.common.save": "Save",
        "agentChat.common.settings": "Settings",
        "agentChat.tabs.newChat": "New chat",
        "agentChat.message.forkChat": "Fork chat",
        "agentChat.recovery.forkDescription": "Fork this chat",
        "agentChat.recovery.forkFailed": "Fork failed",
        "agentChat.recovery.forking": "Forking",
      },
      "de-DE": {
        "agentChat.error.stopped": "The agent stopped before finishing",
        "agentChat.error.failed": "The agent hit an error",
        "agentChat.recovery.copyDebug": "Debug-Informationen kopieren",
        "agentChat.recovery.copyFailed": "Kopieren fehlgeschlagen",
        "agentChat.common.copied": "Kopiert",
        "agentChat.common.details": "Details",
        "agentChat.common.dismiss": "Schließen",
        "agentChat.common.retry": "Retry",
        "agentChat.errorMessages.providerAuthentication":
          "Der Modellanbieter hat den gespeicherten API-Schlüssel abgelehnt.",
        "agentChat.limit.descriptionWithCount":
          "{{formattedCount}} Schritte bleiben für {{scope}}.",
      },
    };
    const table =
      translations[i18nMock.locale as keyof typeof translations] ??
      translations["en-US"];
    const template =
      table[key] ?? (options?.defaultValue as string | undefined) ?? key;
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(options?.[name] ?? ""),
    );
  },
}));

vi.mock("../settings/ProviderSetupForm.js", () => ({
  AgentProviderSetupForm: ({ onConnected }: { onConnected?: () => void }) => {
    const [providerOpen, setProviderOpen] = React.useState(false);
    const [apiKey, setApiKey] = React.useState("");
    return (
      <div>
        <button
          type="button"
          aria-label="Choose a provider"
          onClick={() => setProviderOpen((open) => !open)}
        >
          Choose a provider
        </button>
        {providerOpen ? (
          <div>
            <button type="button">OpenRouter</button>
            <button type="button">Ollama</button>
          </div>
        ) : null}
        <div>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              void agentEngineKeyMock.saveAgentEngineProviderSettings({
                provider: "anthropic",
                key: "ANTHROPIC_API_KEY",
                apiKey,
                scope: "user",
              });
              void agentEngineKeyMock.setAgentEngineProvider({
                provider: "anthropic",
                model: "mock-model",
              });
              onConnected?.();
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  },
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

  it("shows the AI setup flow without a direct retry button for a rejected provider key", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <RunErrorRecoveryCard
            info={{
              message: "Missing Authentication header",
              errorCode: "http_401",
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
    const buttonLabels = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent?.trim() ?? "",
    );
    expect(buttonLabels).not.toContain("Retry");
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
