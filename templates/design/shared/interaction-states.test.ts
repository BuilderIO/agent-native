import { describe, expect, it } from "vitest";

import {
  clearState,
  duplicateStatePreviewRules,
  extractManagedInteractionStateCss,
  injectManagedInteractionStateCss,
  INTERACTION_STATES,
  isInteractionState,
  isSafeInteractionStateCssProperty,
  isSafeInteractionStateCssValue,
  listAllInteractionStateDeclarations,
  listInteractionStates,
  parseInteractionStatesCss,
  readStateStyles,
  removeStateProperty,
  serializeInteractionStatesModel,
  serializeInteractionStatesModelWithPreviews,
  upsertStateStyle,
  upsertStateStyles,
} from "./interaction-states";

const BASE_HTML = `<!doctype html>
<html>
<head><title>Test</title></head>
<body>
<button data-agent-native-node-id="btn_1">Click me</button>
</body>
</html>`;

describe("isInteractionState", () => {
  it("accepts every supported state", () => {
    for (const state of INTERACTION_STATES) {
      expect(isInteractionState(state)).toBe(true);
    }
  });

  it("rejects unsupported values", () => {
    expect(isInteractionState("visited")).toBe(false);
    expect(isInteractionState("Hover")).toBe(false);
    expect(isInteractionState(null)).toBe(false);
    expect(isInteractionState(undefined)).toBe(false);
    expect(isInteractionState("")).toBe(false);
  });
});

describe("isSafeInteractionStateCssValue", () => {
  it("allows normal values and CSS functions", () => {
    expect(isSafeInteractionStateCssValue("#111827")).toBe(true);
    expect(isSafeInteractionStateCssValue("rgb(0, 0, 0)")).toBe(true);
    expect(isSafeInteractionStateCssValue("calc(100% - 8px)")).toBe(true);
    expect(isSafeInteractionStateCssValue("var(--accent)")).toBe(true);
  });

  it("rejects breakout attempts and empty values", () => {
    expect(isSafeInteractionStateCssValue("red; } .evil { color")).toBe(false);
    expect(isSafeInteractionStateCssValue("</style><script>")).toBe(false);
    expect(isSafeInteractionStateCssValue("/* comment */")).toBe(false);
    expect(isSafeInteractionStateCssValue('url("javascript:alert(1)")')).toBe(
      false,
    );
    expect(isSafeInteractionStateCssValue("")).toBe(false);
    expect(isSafeInteractionStateCssValue("   ")).toBe(false);
  });

  it("rejects control characters", () => {
    expect(isSafeInteractionStateCssValue("red\u0000")).toBe(false);
    expect(isSafeInteractionStateCssValue("red\u001f")).toBe(false);
    expect(isSafeInteractionStateCssValue("red\u007f")).toBe(false);
  });
});

describe("isSafeInteractionStateCssProperty", () => {
  it("allows normal and vendor-prefixed properties", () => {
    expect(isSafeInteractionStateCssProperty("color")).toBe(true);
    expect(isSafeInteractionStateCssProperty("background-color")).toBe(true);
    expect(isSafeInteractionStateCssProperty("-webkit-transform")).toBe(true);
  });

  it("rejects invalid identifiers", () => {
    expect(isSafeInteractionStateCssProperty("color; }")).toBe(false);
    expect(isSafeInteractionStateCssProperty("123color")).toBe(false);
    expect(isSafeInteractionStateCssProperty("")).toBe(false);
  });
});

describe("extractManagedInteractionStateCss / injectManagedInteractionStateCss", () => {
  it("returns null when no managed block exists", () => {
    expect(extractManagedInteractionStateCss(BASE_HTML)).toBeNull();
  });

  it("injects a new block before </head> when absent", () => {
    const html = injectManagedInteractionStateCss(
      BASE_HTML,
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
    );
    expect(html).toContain("<style data-agent-native-states>");
    expect(html).toContain('[data-agent-native-node-id="btn_1"]:hover');
    expect(html.indexOf("<style data-agent-native-states>")).toBeLessThan(
      html.indexOf("</head>"),
    );
  });

  it("round-trips extract after inject", () => {
    const css = '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}';
    const html = injectManagedInteractionStateCss(BASE_HTML, css);
    expect(extractManagedInteractionStateCss(html)).toBe(css);
  });

  it("replaces an existing block instead of duplicating it", () => {
    const first = injectManagedInteractionStateCss(
      BASE_HTML,
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
    );
    const second = injectManagedInteractionStateCss(
      first,
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: blue;\n}',
    );
    expect(second.match(/data-agent-native-states/g)?.length).toBe(1);
    expect(second).toContain("color: blue");
    expect(second).not.toContain("color: red");
  });

  it("removes the block entirely when injecting empty CSS", () => {
    const withBlock = injectManagedInteractionStateCss(
      BASE_HTML,
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
    );
    const removed = injectManagedInteractionStateCss(withBlock, "");
    expect(removed).not.toContain("data-agent-native-states");
    // No accumulated blank line where the block used to be.
    expect(removed).toBe(BASE_HTML);
  });

  it("falls back to prepending when there is no <head>", () => {
    const html = injectManagedInteractionStateCss(
      "<body>hi</body>",
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
    );
    expect(html.startsWith("<style data-agent-native-states>")).toBe(true);
  });
});

describe("parseInteractionStatesCss / serializeInteractionStatesModel", () => {
  it("parses a single rule into the model", () => {
    const css =
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n  background-color: blue;\n}';
    const model = parseInteractionStatesCss(css);
    expect(model).toEqual({
      btn_1: { hover: { color: "red", "background-color": "blue" } },
    });
  });

  it("parses multiple states and nodes", () => {
    const css = [
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
      '[data-agent-native-node-id="btn_1"]:focus {\n  outline: 2px solid blue;\n}',
      '[data-agent-native-node-id="card_1"]:active {\n  transform: scale(0.98);\n}',
    ].join("\n\n");
    const model = parseInteractionStatesCss(css);
    expect(model.btn_1?.hover).toEqual({ color: "red" });
    expect(model.btn_1?.focus).toEqual({ outline: "2px solid blue" });
    expect(model.card_1?.active).toEqual({ transform: "scale(0.98)" });
  });

  it("ignores the forced-preview twin selectors when parsing", () => {
    const css = [
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
      '[data-agent-native-node-id="btn_1"][data-an-state-preview="hover"] {\n  color: red;\n}',
    ].join("\n\n");
    const model = parseInteractionStatesCss(css);
    expect(Object.keys(model)).toEqual(["btn_1"]);
    expect(model.btn_1).toEqual({ hover: { color: "red" } });
  });

  it("skips unsafe declarations while keeping safe ones", () => {
    const css =
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n  bad prop: value;\n  background: url(javascript:x);\n}';
    const model = parseInteractionStatesCss(css);
    expect(model.btn_1?.hover).toEqual({ color: "red" });
  });

  it("serializes deterministically: node id, then fixed state order, then property", () => {
    const model = {
      z_node: {
        active: { color: "green" },
        hover: { color: "red" },
      },
      a_node: {
        disabled: { opacity: "0.5" },
        focus: { outline: "1px solid black" },
      },
    };
    const css = serializeInteractionStatesModel(model);
    const hoverIdx = css.indexOf('[data-agent-native-node-id="a_node"]:focus');
    const disabledIdx = css.indexOf(
      '[data-agent-native-node-id="a_node"]:disabled',
    );
    const zNodeIdx = css.indexOf('[data-agent-native-node-id="z_node"]');
    // a_node (alphabetically first) comes before z_node.
    expect(hoverIdx).toBeGreaterThanOrEqual(0);
    expect(hoverIdx).toBeLessThan(zNodeIdx);
    // Within a_node, focus (state order index 1) comes before disabled (index 4).
    expect(hoverIdx).toBeLessThan(disabledIdx);
    // Within z_node, hover comes before active per STATE order? No: hover(0) before active(3).
    const zHoverIdx = css.indexOf('[data-agent-native-node-id="z_node"]:hover');
    const zActiveIdx = css.indexOf(
      '[data-agent-native-node-id="z_node"]:active',
    );
    expect(zHoverIdx).toBeLessThan(zActiveIdx);
  });

  it("produces byte-identical output for the same model (determinism)", () => {
    const model = {
      btn_1: { hover: { color: "red", background: "blue" } },
    };
    expect(serializeInteractionStatesModel(model)).toBe(
      serializeInteractionStatesModel(model),
    );
  });

  it("round-trips parse(serialize(model)) back to the same model", () => {
    const model = {
      btn_1: {
        hover: { color: "red" },
        focus: { outline: "2px solid blue" },
      },
      card_1: { active: { transform: "scale(0.98)" } },
    };
    const roundTripped = parseInteractionStatesCss(
      serializeInteractionStatesModel(model),
    );
    expect(roundTripped).toEqual(model);
  });
});

describe("duplicateStatePreviewRules", () => {
  it("appends a twin attribute-selector rule for every real state rule", () => {
    const html = injectManagedInteractionStateCss(
      BASE_HTML,
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
    );
    const withPreviews = duplicateStatePreviewRules(html);
    expect(withPreviews).toContain(
      '[data-agent-native-node-id="btn_1"][data-an-state-preview="hover"]',
    );
    const css = extractManagedInteractionStateCss(withPreviews) ?? "";
    // Same declarations in both the real rule and the twin.
    const realRuleMatch = /:hover\s*\{\s*color:\s*red;\s*\}/.exec(css);
    const twinRuleMatch =
      /\[data-an-state-preview="hover"\]\s*\{\s*color:\s*red;\s*\}/.exec(css);
    expect(realRuleMatch).not.toBeNull();
    expect(twinRuleMatch).not.toBeNull();
  });

  it("is idempotent — re-running produces byte-identical output", () => {
    const html = injectManagedInteractionStateCss(
      BASE_HTML,
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
    );
    const once = duplicateStatePreviewRules(html);
    const twice = duplicateStatePreviewRules(once);
    expect(extractManagedInteractionStateCss(twice)).toBe(
      extractManagedInteractionStateCss(once),
    );
  });

  it("returns the html unchanged when there is no managed block", () => {
    expect(duplicateStatePreviewRules(BASE_HTML)).toBe(BASE_HTML);
  });

  it("covers multiple states and nodes", () => {
    const model = {
      btn_1: { hover: { color: "red" }, focus: { outline: "2px solid blue" } },
      card_1: { active: { transform: "scale(0.98)" } },
    };
    const html = injectManagedInteractionStateCss(
      BASE_HTML,
      serializeInteractionStatesModel(model),
    );
    const withPreviews = duplicateStatePreviewRules(html);
    expect(withPreviews).toContain('[data-an-state-preview="hover"]');
    expect(withPreviews).toContain('[data-an-state-preview="focus"]');
    expect(withPreviews).toContain('[data-an-state-preview="active"]');
  });
});

describe("serializeInteractionStatesModelWithPreviews", () => {
  it("combines real rules and preview twins in one pass", () => {
    const model = { btn_1: { hover: { color: "red" } } };
    const css = serializeInteractionStatesModelWithPreviews(model);
    expect(css).toContain(":hover {\n  color: red;\n}");
    expect(css).toContain('[data-an-state-preview="hover"]');
  });
});

describe("listInteractionStates", () => {
  it("lists only states with declarations, in fixed order", () => {
    let html = BASE_HTML;
    html = upsertStateStyle(
      html,
      "btn_1",
      "active",
      "transform",
      "scale(0.98)",
    );
    html = upsertStateStyle(html, "btn_1", "hover", "color", "red");
    expect(listInteractionStates(html, "btn_1")).toEqual(["hover", "active"]);
  });

  it("returns an empty array for a node with no overrides", () => {
    expect(listInteractionStates(BASE_HTML, "btn_1")).toEqual([]);
    expect(listInteractionStates(BASE_HTML, "does_not_exist")).toEqual([]);
  });
});

describe("readStateStyles", () => {
  it("returns declared properties for a node's state", () => {
    const html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({ color: "red" });
  });

  it("returns an empty object when nothing is declared", () => {
    expect(readStateStyles(BASE_HTML, "btn_1", "hover")).toEqual({});
    const html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    expect(readStateStyles(html, "btn_1", "focus")).toEqual({});
  });

  it("returns a fresh copy, not a live reference", () => {
    const html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    const styles = readStateStyles(html, "btn_1", "hover");
    styles.color = "blue";
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({ color: "red" });
  });
});

describe("upsertStateStyle / upsertStateStyles", () => {
  it("adds a new declaration", () => {
    const html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({ color: "red" });
  });

  it("overwrites an existing declaration for the same property", () => {
    let html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    html = upsertStateStyle(html, "btn_1", "hover", "color", "blue");
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({ color: "blue" });
  });

  it("normalizes camelCase property names to kebab-case", () => {
    const html = upsertStateStyle(
      BASE_HTML,
      "btn_1",
      "hover",
      "backgroundColor",
      "red",
    );
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({
      "background-color": "red",
    });
  });

  it("keeps declarations for other states/nodes untouched", () => {
    let html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    html = upsertStateStyle(
      html,
      "btn_1",
      "focus",
      "outline",
      "2px solid blue",
    );
    html = upsertStateStyle(
      html,
      "card_1",
      "active",
      "transform",
      "scale(0.98)",
    );
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({ color: "red" });
    expect(readStateStyles(html, "btn_1", "focus")).toEqual({
      outline: "2px solid blue",
    });
    expect(readStateStyles(html, "card_1", "active")).toEqual({
      transform: "scale(0.98)",
    });
  });

  it("batches multiple properties in one call via upsertStateStyles", () => {
    const html = upsertStateStyles(BASE_HTML, "btn_1", "hover", {
      color: "red",
      backgroundColor: "blue",
    });
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({
      color: "red",
      "background-color": "blue",
    });
  });

  it("throws on an invalid state", () => {
    expect(() =>
      // @ts-expect-error -- intentionally invalid for the runtime check
      upsertStateStyle(BASE_HTML, "btn_1", "visited", "color", "red"),
    ).toThrow();
  });

  it("throws on an unsafe property", () => {
    expect(() =>
      upsertStateStyle(BASE_HTML, "btn_1", "hover", "color; }", "red"),
    ).toThrow();
  });

  it("throws on an unsafe value", () => {
    expect(() =>
      upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red; } .evil{}"),
    ).toThrow();
  });

  it("throws when nodeId is empty", () => {
    expect(() =>
      upsertStateStyle(BASE_HTML, "", "hover", "color", "red"),
    ).toThrow();
  });

  it("keeps the forced-preview twin in sync after an upsert", () => {
    const html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    expect(html).toContain('[data-an-state-preview="hover"]');
  });
});

describe("removeStateProperty", () => {
  it("removes a single declared property", () => {
    let html = upsertStateStyles(BASE_HTML, "btn_1", "hover", {
      color: "red",
      opacity: "0.9",
    });
    html = removeStateProperty(html, "btn_1", "hover", "color");
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({ opacity: "0.9" });
  });

  it("prunes the state entry when it becomes empty", () => {
    let html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    html = removeStateProperty(html, "btn_1", "hover", "color");
    expect(listInteractionStates(html, "btn_1")).toEqual([]);
  });

  it("prunes the whole managed block when nothing is left", () => {
    let html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    html = removeStateProperty(html, "btn_1", "hover", "color");
    expect(extractManagedInteractionStateCss(html)).toBeNull();
  });

  it("is a no-op for a property that was never set", () => {
    const html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    const after = removeStateProperty(html, "btn_1", "hover", "opacity");
    expect(after).toBe(html);
  });

  it("is a no-op when the document has no managed block", () => {
    expect(removeStateProperty(BASE_HTML, "btn_1", "hover", "color")).toBe(
      BASE_HTML,
    );
  });

  it("accepts camelCase property names symmetrically with upsert", () => {
    let html = upsertStateStyle(
      BASE_HTML,
      "btn_1",
      "hover",
      "backgroundColor",
      "red",
    );
    html = removeStateProperty(html, "btn_1", "hover", "backgroundColor");
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({});
  });
});

describe("clearState", () => {
  it("removes every declaration for one state, leaving other states intact", () => {
    let html = upsertStateStyles(BASE_HTML, "btn_1", "hover", {
      color: "red",
      opacity: "0.9",
    });
    html = upsertStateStyle(
      html,
      "btn_1",
      "focus",
      "outline",
      "2px solid blue",
    );
    html = clearState(html, "btn_1", "hover");
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({});
    expect(readStateStyles(html, "btn_1", "focus")).toEqual({
      outline: "2px solid blue",
    });
  });

  it("is a no-op when the state has no declarations", () => {
    const html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    const after = clearState(html, "btn_1", "focus");
    expect(after).toBe(html);
  });

  it("prunes the managed block when clearing the only state", () => {
    let html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    html = clearState(html, "btn_1", "hover");
    expect(extractManagedInteractionStateCss(html)).toBeNull();
  });
});

describe("listAllInteractionStateDeclarations", () => {
  it("flattens every declaration across nodes/states, sorted", () => {
    let html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    html = upsertStateStyle(
      html,
      "btn_1",
      "focus",
      "outline",
      "2px solid blue",
    );
    html = upsertStateStyle(
      html,
      "card_1",
      "active",
      "transform",
      "scale(0.98)",
    );
    const all = listAllInteractionStateDeclarations(html);
    expect(all).toEqual([
      {
        nodeId: "btn_1",
        state: "hover",
        property: "color",
        value: "red",
      },
      {
        nodeId: "btn_1",
        state: "focus",
        property: "outline",
        value: "2px solid blue",
      },
      {
        nodeId: "card_1",
        state: "active",
        property: "transform",
        value: "scale(0.98)",
      },
    ]);
  });

  it("filters to one node id when provided", () => {
    let html = upsertStateStyle(BASE_HTML, "btn_1", "hover", "color", "red");
    html = upsertStateStyle(
      html,
      "card_1",
      "active",
      "transform",
      "scale(0.98)",
    );
    const filtered = listAllInteractionStateDeclarations(html, "btn_1");
    expect(filtered).toEqual([
      { nodeId: "btn_1", state: "hover", property: "color", value: "red" },
    ]);
  });

  it("returns an empty array when there is no managed block", () => {
    expect(listAllInteractionStateDeclarations(BASE_HTML)).toEqual([]);
  });
});

describe("Code-panel hand-edit tolerance", () => {
  it("tolerates unrelated CSS mixed into the managed block", () => {
    const css = [
      "/* a hand-written comment */",
      '[data-agent-native-node-id="btn_1"]:hover {\n  color: red;\n}',
      ".some-other-rule { color: green; }",
    ].join("\n\n");
    const html = injectManagedInteractionStateCss(BASE_HTML, css);
    expect(listInteractionStates(html, "btn_1")).toEqual(["hover"]);
  });

  it("supports node ids that require attribute-selector escaping", () => {
    const nodeId = 'weird"id\\here';
    const html = upsertStateStyle(BASE_HTML, nodeId, "hover", "color", "red");
    expect(readStateStyles(html, nodeId, "hover")).toEqual({ color: "red" });
    expect(listInteractionStates(html, nodeId)).toEqual(["hover"]);
  });
});

describe("transition passthrough (documentation contract)", () => {
  it("does not reject the transition property/value inside a state rule", () => {
    // Transitions normally live on the BASE element (see module doc comment),
    // but nothing here special-cases or blocks the "transition" property
    // itself if a caller ever does set it within a state rule — it's just an
    // ordinary CSS property/value pair as far as this module is concerned.
    const html = upsertStateStyle(
      BASE_HTML,
      "btn_1",
      "hover",
      "transition",
      "color 150ms ease",
    );
    expect(readStateStyles(html, "btn_1", "hover")).toEqual({
      transition: "color 150ms ease",
    });
  });
});
