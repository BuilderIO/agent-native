// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firstRunGate = vi.hoisted(() => ({
  ownsSurface: false,
  listeners: new Set<() => void>(),
  update(ownsSurface: boolean) {
    this.ownsSurface = ownsSurface;
    for (const listener of this.listeners) listener();
  },
}));

vi.mock("../app/onboarding/first-run-startup-gate-context.js", async () => {
  const React = await import("react");
  return {
    useFirstRunOnboardingGateOwnsSurface: () =>
      React.useSyncExternalStore(
        (listener) => {
          firstRunGate.listeners.add(listener);
          return () => firstRunGate.listeners.delete(listener);
        },
        () => firstRunGate.ownsSurface,
        () => false,
      ),
  };
});

import { PromptComposer } from "./PromptComposer.js";
import type { TiptapComposerHandle } from "./TiptapComposer.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  firstRunGate.update(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(composerRef: React.Ref<TiptapComposerHandle>) {
  await act(async () => {
    root.render(
      <PromptComposer
        composerRef={composerRef}
        autoFocus
        onSubmit={vi.fn()}
        showModelSelector={false}
        modelStatusChecksEnabled={false}
        includeDefaultMentionSearch={false}
        includeDefaultSlashSkills={false}
        voiceEnabled={false}
      />,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
}

const editor = () => container.querySelector<HTMLElement>(".ProseMirror");

describe("autoFocus", () => {
  it("focuses the editor when the caller passes a ref object", async () => {
    const composerRef = React.createRef<TiptapComposerHandle>();
    await render(composerRef);
    expect(composerRef.current).not.toBeNull();
    expect(document.activeElement).toBe(editor());
  });

  it("focuses the editor when the caller passes a callback ref", async () => {
    let handle: TiptapComposerHandle | null = null;
    await render((next) => {
      handle = next;
    });
    expect(handle).not.toBeNull();
    expect(document.activeElement).toBe(editor());
  });

  it("waits to focus until first-run onboarding releases the app", async () => {
    firstRunGate.update(true);
    const composerRef = React.createRef<TiptapComposerHandle>();
    await render(composerRef);
    expect(document.activeElement).not.toBe(editor());

    firstRunGate.update(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(document.activeElement).toBe(editor());
  });

  it("runs the cleanup a callback ref returns", async () => {
    const cleanup = vi.fn();
    const ref = vi.fn(() => cleanup);
    await render(ref);
    act(() => root.unmount());
    // React detaches with the cleanup, never by calling the ref with null.
    expect(cleanup).toHaveBeenCalledTimes(ref.mock.calls.length);
    expect(ref).not.toHaveBeenCalledWith(null);
    root = createRoot(container);
  });
});
