// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatModels } from "./use-chat-models.js";

function ChatModelsProbe({ enabled }: { enabled: boolean }) {
  const models = useChatModels({ enabled, storageKey: null });
  return (
    <button type="button" onClick={models.refreshEngines}>
      {models.selectedModel}:{models.availableModels.length}
    </button>
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
});
