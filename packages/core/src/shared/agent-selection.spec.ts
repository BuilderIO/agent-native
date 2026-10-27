import { describe, expect, it } from "vitest";

import {
  agentSelectionContextKey,
  formatAgentSelectionPreamble,
  isAgentSelectionContextKey,
  parseAgentSelectionContextKey,
} from "./agent-selection.js";

describe("agent selection context keys", () => {
  it("round-trips kinds and ids, including ids with separators", () => {
    const key = agentSelectionContextKey("slide", "deck:1/slide 2");
    expect(key).toBe("agent-select:slide:deck%3A1%2Fslide%202");
    expect(parseAgentSelectionContextKey(key)).toEqual({
      kind: "slide",
      id: "deck:1/slide 2",
    });
    expect(isAgentSelectionContextKey(key)).toBe(true);
  });

  it("rejects kinds that would make the key ambiguous", () => {
    expect(() => agentSelectionContextKey("a:b", "1")).toThrow(TypeError);
    expect(() => agentSelectionContextKey("panel", " ")).toThrow(TypeError);
  });

  it("does not treat ordinary context keys as selections", () => {
    expect(parseAgentSelectionContextKey("design:selected-element")).toBeNull();
    expect(parseAgentSelectionContextKey("agent-select:panel:")).toBeNull();
    expect(parseAgentSelectionContextKey("agent-select:panel:%E0")).toBeNull();
  });
});

describe("formatAgentSelectionPreamble", () => {
  it("lists only picked objects as the target set", () => {
    const preamble = formatAgentSelectionPreamble([
      { key: "analytics-selected-dashboard", title: "Dashboard: Revenue" },
      { key: agentSelectionContextKey("panel", "p1"), title: "Signups" },
      { key: agentSelectionContextKey("panel", "p2"), title: 'Churn "net"' },
    ]);
    expect(preamble).toBe(
      [
        "## Selected objects",
        "The user picked these objects with Select. They are the target set: apply the request to them and leave everything else unchanged unless the message says otherwise.",
        '- panel "Signups" (id: "p1")',
        '- panel "Churn \\"net\\"" (id: "p2")',
      ].join("\n"),
    );
  });

  it("is empty when nothing was picked", () => {
    expect(formatAgentSelectionPreamble([{ key: "cart", title: "Cart" }])).toBe(
      "",
    );
  });
});
