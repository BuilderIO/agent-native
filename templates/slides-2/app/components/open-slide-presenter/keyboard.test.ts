import { describe, expect, it } from "vitest";

import { getPresenterConsoleCommand, hasPresenterModifier } from "./keyboard";

function keyEvent(
  key: string,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("presenter keyboard commands", () => {
  it("keeps Shift+navigation and held-key repeats active", () => {
    expect(
      getPresenterConsoleCommand(keyEvent("ArrowRight", { shiftKey: true })),
    ).toBe("next");
    expect(
      getPresenterConsoleCommand(keyEvent("ArrowRight", { repeat: true })),
    ).toBe("next");
    expect(getPresenterConsoleCommand(keyEvent("B", { shiftKey: true }))).toBe(
      "blackout",
    );
  });

  it("ignores commands with system modifiers", () => {
    expect(
      getPresenterConsoleCommand(keyEvent("ArrowRight", { metaKey: true })),
    ).toBe(null);
    expect(getPresenterConsoleCommand(keyEvent("b", { ctrlKey: true }))).toBe(
      null,
    );
    expect(getPresenterConsoleCommand(keyEvent("w", { altKey: true }))).toBe(
      null,
    );
    expect(
      hasPresenterModifier(keyEvent("ArrowRight", { shiftKey: true })),
    ).toBe(false);
  });

  it("maps presenter navigation and blackout commands", () => {
    expect(getPresenterConsoleCommand(keyEvent(" "))).toBe("next");
    expect(getPresenterConsoleCommand(keyEvent("PageUp"))).toBe("previous");
    expect(getPresenterConsoleCommand(keyEvent("Home"))).toBe("first");
    expect(getPresenterConsoleCommand(keyEvent("End"))).toBe("last");
    expect(getPresenterConsoleCommand(keyEvent("b"))).toBe("blackout");
    expect(getPresenterConsoleCommand(keyEvent("W"))).toBe("whiteout");
    expect(getPresenterConsoleCommand(keyEvent("x"))).toBe(null);
  });
});
