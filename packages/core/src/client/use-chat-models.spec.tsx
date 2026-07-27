// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatModels } from "./use-chat-models.js";

function ChatModelsProbe({
  enabled,
  storageKey = null,
  id = "probe",
}: {
  enabled: boolean;
  storageKey?: string | null;
  id?: string;
}) {
  const models = useChatModels({ enabled, storageKey });
  return (
    <div>
      <button type="button" onClick={models.refreshEngines}>
        {models.selectedModel}:{models.selectedEffort}:
        {models.availableModels.length}
      </button>
      <button
        type="button"
        data-testid={`${id}-change-model`}
        onClick={() => models.onModelChange("claude-sonnet-5", "anthropic")}
      >
        Change model
      </button>
      <span data-testid={`${id}-selected-model`}>{models.selectedModel}</span>
    </div>
  );
}

describe("useChatModels", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not probe framework model endpoints when disabled", async () => {
    await act(async () => {
      root.render(<ChatModelsProbe enabled={false} />);
      await Promise.resolve();
    });

    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector("button")?.click();
      await Promise.resolve();
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("defaults reasoning to medium", async () => {
    await act(async () => {
      root.render(<ChatModelsProbe enabled={false} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain(":medium:");
  });

  it("migrates a persisted legacy auto selection to medium", async () => {
    window.localStorage.setItem(
      "legacy-reasoning-selection",
      JSON.stringify({ model: "claude-sonnet-5", effort: "auto" }),
    );

    await act(async () => {
      root.render(
        <ChatModelsProbe
          enabled={false}
          storageKey="legacy-reasoning-selection"
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("claude-sonnet-5:medium:");
  });

  it("syncs same-page model changes between hooks sharing a storage key", async () => {
    await act(async () => {
      root.render(
        <>
          <ChatModelsProbe
            enabled={false}
            id="first"
            storageKey="shared-model-selection"
          />
          <ChatModelsProbe
            enabled={false}
            id="second"
            storageKey="shared-model-selection"
          />
        </>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="first-change-model"]')
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="second-selected-model"]')
        ?.textContent,
    ).toBe("claude-sonnet-5");
  });
});
