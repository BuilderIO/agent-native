// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  isGoogleSlidesCommentShortcut,
  isSlidesItalicEditableTarget,
  shouldActivateSlidesCommentShortcut,
  shouldCreateSlideWithShortcut,
  shouldSuppressSlidesItalicShortcut,
  shouldStopSlidesItalicShortcut,
} from "./editor-shortcuts";

function shortcutEvent(
  overrides: Partial<{
    key: string;
    code?: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
    isComposing: boolean;
    target: EventTarget | null;
    defaultPrevented: boolean;
  }> = {},
) {
  return {
    key: overrides.key ?? "i",
    code: overrides.code,
    altKey: overrides.altKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    repeat: overrides.repeat ?? false,
    isComposing: overrides.isComposing ?? false,
    target: overrides.target ?? document.body,
    defaultPrevented: overrides.defaultPrevented ?? false,
  };
}

function shouldCreateSlide(
  event = shortcutEvent({ key: "m", ctrlKey: true }),
  overrides: Partial<{
    canEdit: boolean;
    activeElement: Element | null;
    blockingSurfaceOpen: boolean;
  }> = {},
) {
  return shouldCreateSlideWithShortcut(event, {
    canEdit: overrides.canEdit ?? true,
    activeElement: overrides.activeElement ?? document.body,
    blockingSurfaceOpen: overrides.blockingSurfaceOpen ?? false,
  });
}

function shouldActivateComment(
  event = shortcutEvent({ key: "c" }),
  overrides: Partial<{
    canComment: boolean;
    activeElement: Element | null;
    focusedCanvas: boolean;
    blockingSurfaceOpen: boolean;
  }> = {},
) {
  return shouldActivateSlidesCommentShortcut(event, {
    canComment: overrides.canComment ?? true,
    activeElement: overrides.activeElement ?? document.body,
    focusedCanvas: overrides.focusedCanvas ?? true,
    blockingSurfaceOpen: overrides.blockingSurfaceOpen ?? false,
  });
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

describe("slides comment shortcut helper", () => {
  it("activates C on the focused canvas and Google's shortcut within the canvas", () => {
    expect(shouldActivateComment()).toBe(true);
    expect(
      shouldActivateComment(
        shortcutEvent({ key: "m", ctrlKey: true, altKey: true }),
        { focusedCanvas: false },
      ),
    ).toBe(false);
  });

  it("recognizes the Google shortcut from the physical M key even when another canvas handler prevented it", () => {
    const event = shortcutEvent({
      code: "KeyM",
      key: "Unidentified",
      ctrlKey: true,
      altKey: true,
      defaultPrevented: true,
    });

    expect(isGoogleSlidesCommentShortcut(event)).toBe(true);
    expect(shouldActivateComment(event)).toBe(true);
  });

  it("allows the Google shortcut in slide text editors but not form controls", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    const event = shortcutEvent({
      key: "m",
      ctrlKey: true,
      altKey: true,
      target: editor,
    });

    expect(isGoogleSlidesCommentShortcut(event)).toBe(true);
    expect(
      shouldActivateComment(event, {
        activeElement: editor,
        focusedCanvas: true,
      }),
    ).toBe(true);
    expect(
      shouldActivateComment(event, {
        activeElement: editor,
        focusedCanvas: false,
      }),
    ).toBe(false);
    expect(
      shouldActivateComment(
        shortcutEvent({
          key: "m",
          ctrlKey: true,
          altKey: true,
          target: document.createElement("textarea"),
        }),
      ),
    ).toBe(false);
  });

  it("accepts C when an Excalidraw descendant is in the canvas focus scope", () => {
    const focusScope = document.createElement("div");
    focusScope.setAttribute("data-slide-canvas-focus", "true");
    const excalidrawCanvas = document.createElement("canvas");
    focusScope.append(excalidrawCanvas);
    document.body.append(focusScope);

    expect(
      shouldActivateComment(
        shortcutEvent({ key: "c", target: excalidrawCanvas }),
        {
          activeElement: excalidrawCanvas,
          focusedCanvas:
            excalidrawCanvas.closest("[data-slide-canvas-focus='true']") !==
            null,
        },
      ),
    ).toBe(true);
  });

  it("ignores typing surfaces, other modifiers, and unfocused C presses", () => {
    const textarea = document.createElement("textarea");
    expect(shouldActivateComment(shortcutEvent({ target: textarea }))).toBe(
      false,
    );
    expect(shouldActivateComment(shortcutEvent({ metaKey: true }))).toBe(false);
    expect(
      shouldActivateComment(shortcutEvent({ key: "c" }), {
        focusedCanvas: false,
      }),
    ).toBe(false);
    expect(
      shouldActivateComment(shortcutEvent({ key: "m", ctrlKey: true }), {
        focusedCanvas: false,
      }),
    ).toBe(false);
  });
});

describe("new slide shortcut helper", () => {
  it("accepts the documented Control+M chord", () => {
    expect(shouldCreateSlide()).toBe(true);
  });

  it("ignores other modifiers, repeated keys, and composition", () => {
    expect(shouldCreateSlide(shortcutEvent({ key: "m", metaKey: true }))).toBe(
      false,
    );
    expect(
      shouldCreateSlide(
        shortcutEvent({ key: "m", ctrlKey: true, altKey: true }),
      ),
    ).toBe(false);
    expect(
      shouldCreateSlide(
        shortcutEvent({ key: "m", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      shouldCreateSlide(
        shortcutEvent({ key: "m", ctrlKey: true, repeat: true }),
      ),
    ).toBe(false);
    expect(
      shouldCreateSlide(
        shortcutEvent({ key: "m", ctrlKey: true, isComposing: true }),
      ),
    ).toBe(false);
  });

  it("leaves editing, blocked surfaces, prevented events, and read-only decks alone", () => {
    const input = document.createElement("input");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");

    expect(shouldCreateSlide(shortcutEvent({ target: input }))).toBe(false);
    expect(shouldCreateSlide(undefined, { activeElement: input })).toBe(false);
    expect(shouldCreateSlide(undefined, { activeElement: dialog })).toBe(false);
    expect(shouldCreateSlide(undefined, { blockingSurfaceOpen: true })).toBe(
      false,
    );
    expect(shouldCreateSlide(undefined, { canEdit: false })).toBe(false);
    expect(
      shouldCreateSlide(
        shortcutEvent({ key: "m", ctrlKey: true, defaultPrevented: true }),
      ),
    ).toBe(false);
  });
});
