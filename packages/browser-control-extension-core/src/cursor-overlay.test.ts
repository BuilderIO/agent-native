import { describe, expect, it } from "vitest";

import {
  CURSOR_OVERLAY_FADE_MS,
  CURSOR_OVERLAY_MAX_LIFETIME_MS,
  CURSOR_OVERLAY_VISIBLE_MS,
  cursorOverlayExpression,
} from "./cursor-overlay";

describe("cursor overlay expression", () => {
  it("encodes only bounded coordinates into the fixed overlay script", () => {
    const expression = cursorOverlayExpression({
      type: "show",
      x: 120.5,
      y: 48,
      click: true,
    });

    expect(expression).toContain("agent-native-phantom-cursor");
    expect(expression).toContain('"x":120.5');
    expect(expression).toContain('"y":48');
    expect(expression).toContain('"click":true');
    expect(expression).toContain('label.textContent = "Agent"');
    expect(expression).toContain("border-radius: 2px");
    expect(expression).toContain("#7b61ff");
    expect(expression).toContain("pointer-outline");
    expect(expression).toContain("drop-shadow");
    expect(expression).not.toContain("click-ring");
    expect(expression).not.toContain("royalblue");
    expect(expression).not.toContain("Runtime.evaluate");
    expect(expression).not.toContain("candidate.remove");
  });

  it("rejects coordinates that could escape the page viewport contract", () => {
    expect(() =>
      cursorOverlayExpression({ type: "show", x: Number.NaN, y: 10 }),
    ).toThrow("finite coordinate");
    expect(() =>
      cursorOverlayExpression({ type: "show", x: 10, y: 100_001 }),
    ).toThrow("finite coordinate");
  });

  it("contains a bounded fade and removal deadline", () => {
    const expression = cursorOverlayExpression({ type: "show", x: 0, y: 0 });

    expect(CURSOR_OVERLAY_VISIBLE_MS).toBe(1_800);
    expect(CURSOR_OVERLAY_FADE_MS).toBe(420);
    expect(CURSOR_OVERLAY_MAX_LIFETIME_MS).toBe(2_220);
    expect(expression).toContain("data-state=fading");
    expect(expression).toContain("node.remove()");
    expect(expression).toContain("1800");
    expect(expression).toContain("420");
  });

  it("has an explicit hide expression for teardown and app shutdown", () => {
    const expression = cursorOverlayExpression({ type: "hide" });

    expect(expression).toContain('"type":"hide"');
    expect(expression).toContain("remove(existing)");
  });
});
