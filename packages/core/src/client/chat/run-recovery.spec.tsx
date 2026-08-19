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

  it("keeps the AI setup prompt icon-free while disclosing API keys", async () => {
    await act(async () => {
      root.render(<BuilderSetupContent />);
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).toContain("Connect Builder.io");
    expect(container.querySelector("svg")).toBeNull();

    const apiKeyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Use API key"),
    );
    expect(apiKeyButton).toBeDefined();

    await act(async () => {
      apiKeyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Use your own API key");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders missing-provider recovery as inline setup and retries only on click", async () => {
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <RunErrorRecoveryCard
          info={{
            message: "No LLM provider is connected.",
            errorCode: "missing_credentials",
          }}
          onContinue={vi.fn()}
          onRetry={onRetry}
          onDismiss={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Connect AI");
    expect(container.textContent).not.toContain("The agent hit an error");
    expect(container.textContent).not.toContain(
      "No LLM provider is connected.",
    );
    expect(onRetry).not.toHaveBeenCalled();

    const apiKeyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Use API key"),
    );
    await act(async () => {
      apiKeyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = container.querySelector("input[type='password']");
    expect(input).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      if (input instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input),
          "value",
        )?.set;
        setter?.call(input, "sk-test");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save",
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(agentEngineKeyMock.saveAgentEngineApiKey).toHaveBeenCalled();
    expect(container.textContent).toContain("Retry");
    expect(onRetry).not.toHaveBeenCalled();

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry",
    );
    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps provider authentication failures on the normal error surface", async () => {
    await act(async () => {
      root.render(
        <RunErrorRecoveryCard
          info={{
            message:
              "The model provider rejected the saved API key. Update the key and retry.",
            errorCode: "authentication_error",
          }}
          onContinue={vi.fn()}
          onRetry={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("The agent hit an error");
    expect(container.textContent).toContain("rejected the saved API key");
    expect(container.textContent).not.toContain("Connect AI");
  });
});
