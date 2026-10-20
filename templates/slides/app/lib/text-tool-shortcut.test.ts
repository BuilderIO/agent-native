// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  shouldActivateHandTool,
  shouldActivateMoveTool,
  shouldActivateRectangleTool,
  shouldActivateScaleTool,
  shouldActivateTextTool,
} from "./text-tool-shortcut";

function keyboardEvent(
  overrides: Partial<KeyboardEventInit> & { target?: EventTarget | null } = {},
) {
  const target = overrides.target ?? document.body;
  return {
    key: overrides.key ?? "t",
    altKey: overrides.altKey ?? false,
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    defaultPrevented: false,
    repeat: overrides.repeat ?? false,
    isComposing: false,
    target,
  };
}

function shouldActivate(
  event = keyboardEvent(),
  overrides: Partial<{
    canEdit: boolean;
    activeElement: Element | null;
    blockingSurfaceOpen: boolean;
  }> = {},
) {
  return shouldActivateTextTool(event, {
    canEdit: overrides.canEdit ?? true,
    activeElement: overrides.activeElement ?? document.body,
    blockingSurfaceOpen: overrides.blockingSurfaceOpen ?? false,
  });
}

function shouldActivateRectangle(
  event = keyboardEvent({ key: "r" }),
  overrides: Partial<{
    canEdit: boolean;
    activeElement: Element | null;
    blockingSurfaceOpen: boolean;
  }> = {},
) {
  return shouldActivateRectangleTool(event, {
    canEdit: overrides.canEdit ?? true,
    activeElement: overrides.activeElement ?? document.body,
    blockingSurfaceOpen: overrides.blockingSurfaceOpen ?? false,
  });
}

describe("shouldActivateTextTool", () => {
  it("activates for an unmodified T on the editor canvas", () => {
    expect(shouldActivate()).toBe(true);
  });

  it("ignores modified shortcuts and read-only decks", () => {
    expect(shouldActivate(keyboardEvent({ metaKey: true }))).toBe(false);
    expect(shouldActivate(keyboardEvent({ ctrlKey: true }))).toBe(false);
    expect(shouldActivate(keyboardEvent({ altKey: true }))).toBe(false);
    expect(shouldActivate(keyboardEvent({ shiftKey: true }))).toBe(false);
    expect(shouldActivate(keyboardEvent(), { canEdit: false })).toBe(false);
  });

  it("ignores typing targets", () => {
    for (const element of [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
    ]) {
      expect(shouldActivate(keyboardEvent({ target: element }))).toBe(false);
    }

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(shouldActivate(keyboardEvent({ target: editable }))).toBe(false);
  });

  it("ignores open dialogs and menu surfaces", () => {
    expect(shouldActivate(keyboardEvent(), { blockingSurfaceOpen: true })).toBe(
      false,
    );

    const menuItem = document.createElement("button");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.append(menuItem);
    expect(shouldActivate(keyboardEvent({ target: menuItem }))).toBe(false);
  });
});

describe("shouldActivateRectangleTool", () => {
  it("activates for an unmodified R on the editor canvas", () => {
    expect(shouldActivateRectangle()).toBe(true);
    expect(shouldActivateRectangle(keyboardEvent())).toBe(false);
  });

  it("uses the same editing and modifier guards as the text tool", () => {
    expect(shouldActivateRectangle(keyboardEvent({ metaKey: true }))).toBe(
      false,
    );
    expect(
      shouldActivateRectangle(keyboardEvent(), { blockingSurfaceOpen: true }),
    ).toBe(false);
  });
});

describe("shouldActivateMoveTool", () => {
  const options = {
    canEdit: true,
    activeElement: document.body,
    blockingSurfaceOpen: false,
  };

  it("activates for an unmodified V on the editor canvas", () => {
    expect(shouldActivateMoveTool(keyboardEvent({ key: "v" }), options)).toBe(
      true,
    );
    expect(shouldActivateMoveTool(keyboardEvent({ key: "t" }), options)).toBe(
      false,
    );
  });

  it("leaves paste and typing alone", () => {
    expect(
      shouldActivateMoveTool(
        keyboardEvent({ key: "v", metaKey: true }),
        options,
      ),
    ).toBe(false);
    expect(
      shouldActivateMoveTool(
        keyboardEvent({ key: "v", target: document.createElement("input") }),
        options,
      ),
    ).toBe(false);
  });
});

describe("shouldActivateHandTool", () => {
  const options = {
    canEdit: true,
    activeElement: document.body,
    blockingSurfaceOpen: false,
  };

  it("activates for an unmodified H and ignores typing targets", () => {
    expect(shouldActivateHandTool(keyboardEvent({ key: "h" }), options)).toBe(
      true,
    );
    expect(
      shouldActivateHandTool(
        keyboardEvent({ key: "h", target: document.createElement("textarea") }),
        options,
      ),
    ).toBe(false);
    expect(
      shouldActivateHandTool(
        keyboardEvent({ key: "h", metaKey: true }),
        options,
      ),
    ).toBe(false);
  });
});

describe("shouldActivateScaleTool", () => {
  const options = {
    canEdit: true,
    activeElement: document.body,
    blockingSurfaceOpen: false,
  };

  it("activates for an unmodified K and ignores typing targets", () => {
    expect(shouldActivateScaleTool(keyboardEvent({ key: "k" }), options)).toBe(
      true,
    );
    expect(
      shouldActivateScaleTool(
        keyboardEvent({ key: "k", target: document.createElement("input") }),
        options,
      ),
    ).toBe(false);
    expect(
      shouldActivateScaleTool(
        keyboardEvent({ key: "k", metaKey: true }),
        options,
      ),
    ).toBe(false);
  });
});
