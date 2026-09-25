// @vitest-environment happy-dom

import {
  useComposerRuntimeAdapters,
  type ComposerRuntimeAdapters,
} from "@agent-native/toolkit/composer/runtime-adapters";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoreComposerRuntimeProvider } from "./runtime-adapters.js";

// Stable per locale, like the real `useFormatters()`.
const formatters = { formatNumber: (value: number) => String(value) };
const translate = (key: string) => key;
vi.mock("../i18n.js", () => ({
  useFormatters: () => formatters,
  useT: () => translate,
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
  it("keeps the adapters identity across re-renders", () => {
    const seen: ComposerRuntimeAdapters[] = [];
    function Consumer({ tick }: { tick: number }) {
      seen.push(useComposerRuntimeAdapters());
      return <span>{tick}</span>;
    }
    const render = (tick: number) =>
      act(() => {
        root.render(
          <CoreComposerRuntimeProvider>
            <Consumer tick={tick} />
          </CoreComposerRuntimeProvider>,
        );
      });

    render(1);
    render(2);
    render(3);

    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });
});
