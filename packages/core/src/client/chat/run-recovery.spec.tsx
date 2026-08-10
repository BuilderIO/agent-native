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

import { BuilderSetupContent, RunErrorRecoveryCard } from "./run-recovery.js";

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
        <RunErrorRecoveryCard
          info={{
            message: "The agent stopped before finishing.",
            errorCode: "connection_error",
            runId: "run-123",
            details: "attempted_runs: run-1, run-2",
            recoverable: true,
          }}
          onContinue={vi.fn()}
          onRetry={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    });

    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Copy debug"),
    );
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(clipboardMock.writeClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("attempted_runs: run-1, run-2"),
    );
    expect(container.textContent).toContain("Copy failed");
  });

  it("shows the searchable provider setup while disclosing API keys", async () => {
    await act(async () => {
      root.render(<BuilderSetupContent />);
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

  it("shows the AI setup flow and retry for a rejected provider key", async () => {
    await act(async () => {
      root.render(
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
        />,
      );
    });

    expect(container.textContent).toContain("Connect Builder.io");
    expect(container.textContent).toContain("Custom keys");
    expect(container.textContent).toContain("Retry");
  });

  it("dismisses the recovery card after saving a provider key", async () => {
    const onDismiss = vi.fn();

    await act(async () => {
      root.render(
        <RunErrorRecoveryCard
          info={{
            message:
              "The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
            errorCode: "authentication_error",
          }}
          onContinue={vi.fn()}
          onRetry={vi.fn()}
          onDismiss={onDismiss}
        />,
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
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
