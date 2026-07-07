import { describe, expect, it } from "vitest";

import {
  extractManagedBreakpointCss,
  getBreakpointMediaDeclarations,
  getBreakpointOverrideState,
  injectManagedBreakpointCss,
  isSafeBreakpointCssValue,
  parseBreakpointMediaCss,
  removeBreakpointMediaDeclaration,
  serializeBreakpointMediaModel,
  setBreakpointMediaDeclaration,
} from "./breakpoint-media.js";

const doc = (head = "", body = "") =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("managed block extraction / injection", () => {
  it("returns null when the document has no managed block", () => {
    expect(extractManagedBreakpointCss(doc())).toBeNull();
  });

  it("injects before </head> and round-trips the CSS body", () => {
    const css = "@media (max-width: 809px) {\n  /* x */\n}";
    const html = injectManagedBreakpointCss(doc(), css);
    expect(html).toContain("<style data-agent-native-breakpoints>");
    expect(extractManagedBreakpointCss(html)).toBe(css);
  });

  it("replaces an existing managed block instead of duplicating it", () => {
    const first = injectManagedBreakpointCss(doc(), "/* one */");
    const second = injectManagedBreakpointCss(first, "/* two */");
    expect(second.match(/data-agent-native-breakpoints/g) ?? []).toHaveLength(
      1,
    );
    expect(extractManagedBreakpointCss(second)).toBe("/* two */");
  });

  it("removes the block entirely when the CSS is empty", () => {
    const withBlock = injectManagedBreakpointCss(doc(), "/* x */");
    const removed = injectManagedBreakpointCss(withBlock, "");
    expect(removed).not.toContain("data-agent-native-breakpoints");
  });
});

describe("CSS body parse / serialize round-trip", () => {
  it("round-trips a two-bucket model deterministically", () => {
    const model = {
      "1279": { "node-a": { left: "137px", top: "24px" } },
      "809": { "node-a": { left: "12px" }, "node-b": { opacity: "0.5" } },
    };
    const css = serializeBreakpointMediaModel(model);
    // Wider bucket first so narrower ranges win by source order.
    expect(css.indexOf("max-width: 1279px")).toBeLessThan(
      css.indexOf("max-width: 809px"),
    );
    expect(parseBreakpointMediaCss(css)).toEqual(model);
    // Deterministic: serialize(parse(serialize(m))) === serialize(m).
    expect(serializeBreakpointMediaModel(parseBreakpointMediaCss(css))).toBe(
      css,
    );
  });

  it("skips unsafe declarations when parsing hand-edited CSS", () => {
    const css =
      `@media (max-width: 809px) {\n` +
      `  [data-agent-native-node-id="node-a"] {\n` +
      `    left: 12px;\n` +
      `    background: url(https://evil.example/x.png);\n` +
      `  }\n` +
      `}`;
    expect(parseBreakpointMediaCss(css)).toEqual({
      "809": { "node-a": { left: "12px" } },
    });
  });
});

describe("set / remove declarations on a document", () => {
  it("sets, overwrites, and removes one declaration", () => {
    const base = doc("", '<div data-agent-native-node-id="hero">x</div>');
    let html = setBreakpointMediaDeclaration(base, {
      nodeId: "hero",
      maxWidthPx: 809,
      property: "left",
      value: "137px",
    });
    expect(getBreakpointMediaDeclarations(html, "hero")).toEqual([
      { maxWidthPx: 809, nodeId: "hero", property: "left", value: "137px" },
    ]);

    html = setBreakpointMediaDeclaration(html, {
      nodeId: "hero",
      maxWidthPx: 809,
      property: "left",
      value: "24px",
    });
    expect(getBreakpointMediaDeclarations(html, "hero")).toEqual([
      { maxWidthPx: 809, nodeId: "hero", property: "left", value: "24px" },
    ]);

    html = removeBreakpointMediaDeclaration(html, {
      nodeId: "hero",
      maxWidthPx: 809,
      property: "left",
    });
    expect(getBreakpointMediaDeclarations(html, "hero")).toEqual([]);
    // Empty model prunes the whole managed block.
    expect(html).not.toContain("data-agent-native-breakpoints");
  });

  it("normalizes camelCase properties", () => {
    const html = setBreakpointMediaDeclaration(doc(), {
      nodeId: "hero",
      maxWidthPx: 1279,
      property: "backgroundColor",
      value: "rgb(255, 0, 0)",
    });
    expect(extractManagedBreakpointCss(html)).toContain(
      "background-color: rgb(255, 0, 0);",
    );
  });

  it("rejects unsafe values and properties", () => {
    expect(() =>
      setBreakpointMediaDeclaration(doc(), {
        nodeId: "hero",
        maxWidthPx: 809,
        property: "left",
        value: "12px; } body { background: red",
      }),
    ).toThrow(/not allowed/);
    expect(() =>
      setBreakpointMediaDeclaration(doc(), {
        nodeId: "hero",
        maxWidthPx: 809,
        property: "left}",
        value: "12px",
      }),
    ).toThrow(/Invalid breakpoint override property/);
    expect(isSafeBreakpointCssValue("url(https://x)")).toBe(false);
    expect(isSafeBreakpointCssValue("calc(100% - 8px)")).toBe(true);
  });
});

describe("getBreakpointOverrideState (EditPanel indicator contract)", () => {
  const breakpointWidths = [390, 810];
  const baseWidthPx = 1280;

  it("aggregates class and media overrides, widest first", () => {
    const html = setBreakpointMediaDeclaration(
      doc("", '<div data-agent-native-node-id="hero">x</div>'),
      { nodeId: "hero", maxWidthPx: 809, property: "left", value: "12px" },
    );
    const state = getBreakpointOverrideState({
      className: "left-4 max-[1279px]:left-8",
      html,
      nodeId: "hero",
      property: "left",
      breakpointWidths,
      baseWidthPx,
      activeWidthPx: 390,
    });
    expect(state.overrides).toEqual([
      { maxWidthPx: 1279, source: "class", value: "left-8" },
      { maxWidthPx: 809, source: "media", value: "12px" },
    ]);
    // Active 390 → bound 809 → the media override matches the active scope.
    expect(state.activeUpperBoundPx).toBe(809);
    expect(state.overriddenAtActive).toBe(true);
  });

  it("reports no active override when editing the base", () => {
    const state = getBreakpointOverrideState({
      className: "max-[809px]:text-sm",
      property: "fontSize",
      breakpointWidths,
      baseWidthPx,
      activeWidthPx: null,
    });
    expect(state.activeUpperBoundPx).toBeNull();
    expect(state.overriddenAtActive).toBe(false);
    expect(state.overrides).toEqual([
      { maxWidthPx: 809, source: "class", value: "text-sm" },
    ]);
  });
});
