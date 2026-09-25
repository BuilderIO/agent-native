// @vitest-environment happy-dom

import { useComposerRuntimeAdapters } from "@agent-native/toolkit/composer/runtime-adapters";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoreComposerRuntimeProvider } from "./index.js";

vi.mock("../i18n.js", () => ({
  useFormatters: () => ({
    formatNumber: (value: number) => String(value),
  }),
  useT: () => (key: string) => key,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CoreComposerRuntimeProvider", () => {
  it("provides the complete composer runtime at mount", () => {
    const modelHooks: unknown[] = [];

    function Consumer() {
      const adapters = useComposerRuntimeAdapters();
      modelHooks.push(adapters.models?.useChatModels);
      const models = adapters.models!.useChatModels!({ enabled: false });
      return <span>{models.selectedModel}</span>;
    }

    act(() => {
      root.render(
        <CoreComposerRuntimeProvider>
          <Consumer />
        </CoreComposerRuntimeProvider>,
      );
    });

    expect(container.textContent).not.toBe("");
    expect(new Set(modelHooks).size).toBe(1);
  });
});
