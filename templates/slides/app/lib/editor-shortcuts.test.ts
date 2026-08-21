// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  isSlidesItalicEditableTarget,
  shouldSuppressSlidesItalicShortcut,
  shouldStopSlidesItalicShortcut,
} from "./editor-shortcuts";

function shortcutEvent(
  overrides: Partial<{
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
    isComposing: boolean;
    target: EventTarget | null;
  }> = {},
) {
  return {
    key: overrides.key ?? "i",
    altKey: overrides.altKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    repeat: overrides.repeat ?? false,
    isComposing: overrides.isComposing ?? false,
    target: overrides.target ?? document.body,
  };
}

describe("slides italic shortcut helper", () => {
  it("claims Cmd/Ctrl+I and ignores modified or repeated keys", () => {
    expect(
      shouldStopSlidesItalicShortcut(shortcutEvent({ metaKey: true })),
    ).toBe(true);
    expect(
      shouldStopSlidesItalicShortcut(shortcutEvent({ ctrlKey: true })),
    ).toBe(true);
    expect(shouldStopSlidesItalicShortcut(shortcutEvent({ key: "u" }))).toBe(
      false,
    );
    expect(
      shouldStopSlidesItalicShortcut(shortcutEvent({ altKey: true })),
    ).toBe(false);
    expect(
      shouldStopSlidesItalicShortcut(shortcutEvent({ shiftKey: true })),
    ).toBe(false);
    expect(
      shouldStopSlidesItalicShortcut(shortcutEvent({ repeat: true })),
    ).toBe(false);
  });

  it("recognizes editable targets so native italic formatting can still run", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.contentEditable = "true";

    expect(isSlidesItalicEditableTarget(shortcutEvent({ target: input }))).toBe(
      true,
    );
    expect(
      isSlidesItalicEditableTarget(shortcutEvent({ target: editor })),
    ).toBe(true);
    expect(isSlidesItalicEditableTarget(shortcutEvent())).toBe(false);
  });

  it("suppresses the slide shortcut only outside editable targets", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";

    expect(
      shouldSuppressSlidesItalicShortcut(
        shortcutEvent({ metaKey: true, target: editor }),
      ),
    ).toBe(false);
    expect(
      shouldSuppressSlidesItalicShortcut(
        shortcutEvent({ metaKey: true, target: document.body }),
      ),
    ).toBe(true);
  });
});
