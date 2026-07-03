// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { isDesignHotkeyEditableTarget } from "./useDesignHotkeys";

describe("isDesignHotkeyEditableTarget", () => {
  it("treats Monaco-style textbox elements as editable targets", () => {
    const root = document.createElement("div");
    root.setAttribute("data-hotkeys-scope", "text");
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    root.append(textbox);
    document.body.append(root);

    expect(isDesignHotkeyEditableTarget(textbox)).toBe(true);

    root.remove();
  });
});
