// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { CommentMentionEditor } from "./PlansPage";

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

const settle = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

function editor() {
  return container.querySelector<HTMLElement>('[contenteditable="true"]')!;
}

function render(focusKey?: unknown) {
  act(() =>
    root.render(
      <>
        <button type="button" data-outside />
        <CommentMentionEditor
          placeholder="Add a comment"
          autoFocus
          focusKey={focusKey}
          onChange={() => {}}
        />
      </>,
    ),
  );
}

describe("comment editor focus", () => {
  it("takes focus back from a menu that still traps it on mount", async () => {
    const outside = () =>
      container.querySelector<HTMLButtonElement>("[data-outside]")!;
    // Like a closing Radix menu: the first time focus leaves, pull it back.
    let trapped = true;
    const trap = (event: FocusEvent) => {
      if (!trapped || event.target === outside()) return;
      trapped = false;
      outside().focus();
    };
    document.addEventListener("focusin", trap);
    try {
      render();
      expect(document.activeElement).toBe(outside());
      await settle();
      expect(document.activeElement).toBe(editor());
    } finally {
      document.removeEventListener("focusin", trap);
    }
  });

  it("puts the caret back in a moved draft without clearing it", async () => {
    render({ x: 1 });
    await settle();
    editor().textContent = "Tighten this step";
    container.querySelector<HTMLButtonElement>("[data-outside]")!.focus();

    render({ x: 2 });

    expect(document.activeElement).toBe(editor());
    expect(editor().textContent).toBe("Tighten this step");
  });
});
