// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import {
  CONTENT_COMMAND_MENU_OPEN_EVENT,
  openContentCommandMenu,
} from "./content-command-menu";

describe("openContentCommandMenu", () => {
  it("carries the visible launcher that should regain focus", () => {
    const launcher = document.createElement("button");
    const listener = vi.fn();
    window.addEventListener(CONTENT_COMMAND_MENU_OPEN_EVENT, listener);

    openContentCommandMenu(launcher);

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      returnFocusTo: launcher,
    });
    window.removeEventListener(CONTENT_COMMAND_MENU_OPEN_EVENT, listener);
  });
});
