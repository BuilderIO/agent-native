import { describe, expect, it } from "vitest";

import {
  getChromeBorderTransition,
  getSelectionBoxTransition,
  isDirectScreenHoverTarget,
} from "./MultiScreenCanvas";

describe("MultiScreenCanvas selection chrome transitions", () => {
  it("does not animate selected-frame geometry during normal selection changes", () => {
    expect(getSelectionBoxTransition(false)).toBe("none");
  });

  it("settles selected-frame chrome after zoom without animating position", () => {
    const transition = getSelectionBoxTransition(true);

    expect(transition).toContain("border-width");
    expect(transition).toContain("border-radius");
    expect(transition).not.toMatch(/\b(?:inset|left|right|top|bottom)\b/);
  });

  it("keeps hover chrome free to settle its inset after zoom", () => {
    expect(getChromeBorderTransition(true)).toContain("inset");
  });

  it("treats screen content as child hover instead of direct frame hover", () => {
    const frame = { closest: () => null } as unknown as HTMLElement;
    const screenContentChild = {
      closest: (selector: string) =>
        selector === "[data-screen-content]" ? {} : null,
    } as unknown as Element;

    expect(isDirectScreenHoverTarget(frame, frame)).toBe(true);
    expect(isDirectScreenHoverTarget(screenContentChild, frame)).toBe(false);
  });
});
