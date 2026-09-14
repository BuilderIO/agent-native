import { describe, expect, it, vi } from "vitest";

import { forwardDesktopNavigationShortcutInput } from "./desktop-navigation-shortcuts.js";

describe("desktop navigation shortcut forwarding", () => {
  it("forwards Cmd+, to the shell settings shortcut", () => {
    const event = { preventDefault: vi.fn() };
    const send = vi.fn();

    expect(
      forwardDesktopNavigationShortcutInput(
        event,
        { type: "keyDown", key: ",", code: "Comma", meta: true },
        send,
      ),
    ).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      key: ",",
      code: "Comma",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: true,
    });
  });

  it("forwards Cmd+[ and Cmd+] for app history navigation", () => {
    const send = vi.fn();

    for (const [key, code] of [
      ["[", "BracketLeft"],
      ["]", "BracketRight"],
    ] as const) {
      const event = { preventDefault: vi.fn() };
      expect(
        forwardDesktopNavigationShortcutInput(
          event,
          { type: "keyDown", key, code, meta: true },
          send,
          true,
        ),
      ).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }

    expect(send).toHaveBeenNthCalledWith(1, {
      key: "[",
      code: "BracketLeft",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: true,
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      key: "]",
      code: "BracketRight",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: true,
    });
  });

  it("leaves unshifted brackets in non-Content guests", () => {
    const event = { preventDefault: vi.fn() };
    const send = vi.fn();

    expect(
      forwardDesktopNavigationShortcutInput(
        event,
        { type: "keyDown", key: "[", code: "BracketLeft", meta: true },
        send,
      ),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves unshifted Ctrl+brackets in Content guests", () => {
    const event = { preventDefault: vi.fn() };
    const send = vi.fn();

    expect(
      forwardDesktopNavigationShortcutInput(
        event,
        { type: "keyDown", key: "[", code: "BracketLeft", control: true },
        send,
        true,
      ),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves unrelated key events for the guest app", () => {
    const event = { preventDefault: vi.fn() };
    const send = vi.fn();

    expect(
      forwardDesktopNavigationShortcutInput(
        event,
        { type: "keyDown", key: "x", meta: true },
        send,
      ),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
