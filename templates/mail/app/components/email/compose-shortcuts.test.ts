import { describe, expect, it, vi } from "vitest";

import { handleComposeSendShortcut } from "./compose-shortcuts";

describe("compose send shortcut", () => {
  it.each([
    { label: "Command", metaKey: true, ctrlKey: false },
    { label: "Control", metaKey: false, ctrlKey: true },
  ])("sends normally with $label+Enter", ({ metaKey, ctrlKey }) => {
    const onSend = vi.fn();
    const event = {
      key: "Enter",
      metaKey,
      ctrlKey,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    expect(handleComposeSendShortcut(event, onSend)).toBe(true);
    expect(onSend).toHaveBeenCalledWith(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "Command", metaKey: true, ctrlKey: false },
    { label: "Control", metaKey: false, ctrlKey: true },
  ])("sends and marks Done with $label+Shift+Enter", ({ metaKey, ctrlKey }) => {
    const onSend = vi.fn();
    const event = {
      key: "Enter",
      metaKey,
      ctrlKey,
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    expect(handleComposeSendShortcut(event, onSend)).toBe(true);
    expect(onSend).toHaveBeenCalledWith(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("does not intercept Enter without a platform modifier", () => {
    const onSend = vi.fn();
    const event = {
      key: "Enter",
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    expect(handleComposeSendShortcut(event, onSend)).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});
