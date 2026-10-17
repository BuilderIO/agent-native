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

  it("leaves Cmd+, for a focused app webview to open its own Settings", () => {
    const event = { preventDefault: vi.fn() };
    const send = vi.fn();

    expect(
      forwardDesktopNavigationShortcutInput(
        event,
        { type: "keyDown", key: ",", code: "Comma", meta: true },
        send,
        "app-webview",
      ),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("still forwards numeric app switching from a focused app webview", () => {
    const event = { preventDefault: vi.fn() };
    const send = vi.fn();

    expect(
      forwardDesktopNavigationShortcutInput(
        event,
        { type: "keyDown", key: "2", code: "Digit2", meta: true },
        send,
        "app-webview",
      ),
    ).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ key: "2", metaKey: true }),
    );
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

  it("leaves shifted bracket history shortcuts for the guest app", () => {
    const event = { preventDefault: vi.fn() };
    const send = vi.fn();

    expect(
      forwardDesktopNavigationShortcutInput(
        event,
        {
          type: "keyDown",
          key: "{",
          code: "BracketLeft",
          meta: true,
          shift: true,
        },
        send,
      ),
    ).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
