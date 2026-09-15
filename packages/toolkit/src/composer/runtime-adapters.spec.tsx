// @vitest-environment happy-dom

import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ComposerRuntimeAdaptersProvider,
  useComposerRuntimeAdapters,
  type ComposerRuntimeAdapters,
} from "./runtime-adapters.js";

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

describe("ComposerRuntimeAdaptersProvider", () => {
  it("interpolates fallback translations without a provider", () => {
    let translated = "";

    function Consumer() {
      const runtime = useComposerRuntimeAdapters();
      translated = runtime.translate!("attachment.tooLarge", {
        defaultValue: '"{{name}}" is {{size}} MB (max {{maxSize}} MB)',
        name: "report.pdf",
        size: 12.5,
        maxSize: 10,
      });
      return null;
    }

    act(() => root.render(<Consumer />));

    expect(translated).toBe('"report.pdf" is 12.5 MB (max 10 MB)');
  });

  it("keeps the context value stable so consumer effects do not refire", () => {
    const readAppState = vi.fn(() => undefined);
    const adapters: ComposerRuntimeAdapters = { voice: { readAppState } };
    const seen: ComposerRuntimeAdapters[] = [];

    function Consumer() {
      const runtime = useComposerRuntimeAdapters();
      seen.push(runtime);
      // Mirrors VoiceButton's voice-input-preference read.
      useEffect(() => {
        void runtime.voice!.readAppState!("voice-input-preference");
      }, [runtime]);
      return null;
    }

    function Tree({ tick }: { tick: number }) {
      return (
        <ComposerRuntimeAdaptersProvider adapters={adapters}>
          <span>{tick}</span>
          <Consumer />
        </ComposerRuntimeAdaptersProvider>
      );
    }

    act(() => root.render(<Tree tick={0} />));
    act(() => root.render(<Tree tick={1} />));
    act(() => root.render(<Tree tick={2} />));

    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
    expect(readAppState).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the context value when the adapters prop changes", () => {
    const seen: ComposerRuntimeAdapters[] = [];

    function Consumer() {
      seen.push(useComposerRuntimeAdapters());
      return null;
    }

    const render = (adapters: ComposerRuntimeAdapters) =>
      act(() =>
        root.render(
          <ComposerRuntimeAdaptersProvider adapters={adapters}>
            <Consumer />
          </ComposerRuntimeAdaptersProvider>,
        ),
      );

    render({ resolvePath: (path) => `/a${path}` });
    render({ resolvePath: (path) => `/b${path}` });

    expect(seen.at(-1)!.resolvePath!("/x")).toBe("/b/x");
  });
});
