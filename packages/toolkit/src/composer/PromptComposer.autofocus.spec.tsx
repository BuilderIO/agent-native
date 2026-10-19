// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptComposer } from "./PromptComposer.js";
import type { TiptapComposerHandle } from "./TiptapComposer.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
});
