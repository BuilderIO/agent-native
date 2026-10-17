import { describe, expect, it } from "vitest";

import action, {
  applyRootAttributeEdit,
  escapeAttributeValue,
} from "./apply-component-prop-edit.js";

describe("apply-component-prop-edit schema", () => {
  const base = { designId: "design_1", nodeId: "node_1" };

  it("accepts an alpineData edit", () => {
    expect(
      action.schema.safeParse({
        ...base,
        edit: { kind: "alpineData", value: "{ variant: 'outline' }" },
      }).success,
    ).toBe(true);
  });

  it("accepts an attribute edit with a safe identifier name", () => {
    expect(
      action.schema.safeParse({
        ...base,
        edit: {
          kind: "attribute",
          attribute: "data-agent-native-prop-label",
          value: "Save",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an attribute edit with an event-handler name (on*)", () => {
    expect(
      action.schema.safeParse({
        ...base,
        edit: { kind: "attribute", attribute: "onclick", value: "alert(1)" },
      }).success,
    ).toBe(false);
  });

  it("rejects an attribute name with spaces / quotes", () => {
    expect(
      action.schema.safeParse({
        ...base,
        edit: {
          kind: "attribute",
          attribute: 'x" onload="y',
          value: "z",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a classReplace edit", () => {
    expect(
      action.schema.safeParse({
        ...base,
        edit: { kind: "classReplace", from: "bg-blue-500", to: "bg-red-500" },
      }).success,
    ).toBe(true);
  });

  it("accepts an optional fileId so non-index screens can be targeted (Bug 2)", () => {
    const parsed = action.schema.safeParse({
      ...base,
      fileId: "file_about",
      edit: { kind: "alpineData", value: "{ variant: 'outline' }" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.fileId).toBe("file_about");
  });

  it("accepts a snapshot structure edit with a durable post-selection", () => {
    expect(
      action.schema.safeParse({
        ...base,
        fileId: "file_main",
        edit: {
          kind: "structure",
          before: '<main data-agent-native-node-id="root"></main>',
          after:
            '<main data-agent-native-node-id="root"><div data-agent-native-node-id="clone"></div></main>',
          selectionNodeIds: ["clone"],
        },
        source: {
          expectedFiles: [{ fileId: "file_main", versionHash: "hash" }],
        },
      }).success,
    ).toBe(true);
  });

  it("accepts bounded semantic structure edits with composite style intents", () => {
    expect(
      action.schema.safeParse({
        ...base,
        fileId: "file_main",
        edit: {
          kind: "structure",
          intents: [
            {
              kind: "wrapNodes",
              targetIds: ["layer_a", "layer_b"],
              wrapperKind: "frame",
              sizeHints: { layer_a: { width: 40, height: 20 } },
            },
            {
              kind: "style",
              target: { nodeId: "layer_a" },
              property: "width",
              value: "40px",
            },
          ],
        },
        source: {
          expectedFiles: [{ fileId: "file_main", versionHash: "hash" }],
        },
      }).success,
    ).toBe(true);
  });

  it("accepts measured relative offsets while keeping size-only hints valid", () => {
    expect(
      action.schema.safeParse({
        ...base,
        fileId: "file_main",
        edit: {
          kind: "structure",
          intents: [
            {
              kind: "wrapNodes",
              targetIds: ["layer_a", "layer_b"],
              sizeHints: {
                layer_a: { width: 40, height: 20, left: -12.5, top: 8.25 },
                layer_b: { width: 80, height: 24 },
              },
            },
          ],
        },
        source: {
          expectedFiles: [{ fileId: "file_main", versionHash: "hash" }],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects non-finite and unbounded structure size hints", () => {
    const makeInput = (hint: Record<string, number>) => ({
      ...base,
      edit: {
        kind: "structure" as const,
        intents: [
          {
            kind: "wrapNodes" as const,
            targetIds: ["layer_a"],
            sizeHints: { layer_a: hint },
          },
        ],
      },
    });

    expect(
      action.schema.safeParse(
        makeInput({ width: 40, height: 20, left: Number.POSITIVE_INFINITY }),
      ).success,
    ).toBe(false);
    expect(
      action.schema.safeParse(makeInput({ width: 1_000_001, height: 20 }))
        .success,
    ).toBe(false);
    expect(
      action.schema.safeParse(makeInput({ width: -1, height: 20 })).success,
    ).toBe(false);
  });

  it("accepts semantic component main archive edits", () => {
    for (const kind of ["deleteMain", "restoreMain"] as const) {
      expect(
        action.schema.safeParse({
          ...base,
          fileId: "file_main",
          edit: { kind },
          source: {
            expectedFiles: [{ fileId: "file_main", versionHash: "hash" }],
          },
        }).success,
      ).toBe(true);
    }
  });

  it("rejects selectors and unsupported structural intents at the action boundary", () => {
    expect(
      action.schema.safeParse({
        ...base,
        edit: {
          kind: "structure",
          intents: [
            {
              kind: "deleteNode",
              target: { selector: ".stale-target" },
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        ...base,
        edit: {
          kind: "structure",
          intents: [{ kind: "booleanSubtract", targetIds: ["a", "b"] }],
        },
      }).success,
    ).toBe(false);
  });
});

describe("escapeAttributeValue", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeAttributeValue('"<&>"')).toBe("&quot;&lt;&amp;&gt;&quot;");
  });

  it("escapes ampersands before other entities (no double-escape)", () => {
    expect(escapeAttributeValue("a&b")).toBe("a&amp;b");
  });

  it("leaves a plain value untouched", () => {
    expect(escapeAttributeValue("outline")).toBe("outline");
  });
});

describe("applyRootAttributeEdit", () => {
  it("preserves replacement tokens in an existing attribute value", () => {
    const html = '<button data-label="before">Child</button>';
    const value = "$1 $$ $` $'";
    expect(
      applyRootAttributeEdit(
        html,
        { openStart: 0, openEnd: html.indexOf(">") + 1 },
        "data-label",
        value,
      ),
    ).toEqual({
      content: `<button data-label="${value}">Child</button>`,
      changed: true,
    });
  });

  const html = `<button class="btn" data-agent-native-prop-variant="solid">Save</button>`;
  const openEnd = html.indexOf(">") + 1;
  const source = { openStart: 0, openEnd };

  it("replaces an existing attribute value on the root open tag", () => {
    const out = applyRootAttributeEdit(
      html,
      source,
      "data-agent-native-prop-variant",
      "outline",
    );
    expect(out.changed).toBe(true);
    expect(out.content).toContain('data-agent-native-prop-variant="outline"');
    expect(out.content).not.toContain('data-agent-native-prop-variant="solid"');
    expect(out.content).toContain(">Save</button>");
  });

  it("inserts a new attribute when none exists yet", () => {
    const out = applyRootAttributeEdit(
      html,
      source,
      "data-agent-native-prop-label",
      "Submit",
    );
    expect(out.changed).toBe(true);
    expect(out.content).toContain('data-agent-native-prop-label="Submit"');
    expect(
      out.content.indexOf('data-agent-native-prop-label="Submit"'),
    ).toBeLessThan(out.content.indexOf(">Save"));
  });

  it("writes the x-data attribute for an Alpine variant switch", () => {
    const out = applyRootAttributeEdit(
      `<div x-data="{ variant: 'solid' }">x</div>`,
      { openStart: 0, openEnd: `<div x-data="{ variant: 'solid' }">`.length },
      "x-data",
      "{ variant: 'outline' }",
    );
    expect(out.changed).toBe(true);
    expect(out.content).toContain(`x-data="{ variant: 'outline' }"`);
  });

  it("escapes the value so it cannot break out of the attribute", () => {
    const out = applyRootAttributeEdit(
      html,
      source,
      "data-agent-native-prop-label",
      '"><script>alert(1)</script>',
    );
    expect(out.changed).toBe(true);
    expect(out.content).not.toContain("<script>");
    expect(out.content).toContain("&lt;script&gt;");
  });

  it("handles a self-closing open tag (inserts before close)", () => {
    const selfClosing = `<input class="x"/>`;
    const out = applyRootAttributeEdit(
      selfClosing,
      { openStart: 0, openEnd: selfClosing.length },
      "data-agent-native-prop-value",
      "hi",
    );
    expect(out.changed).toBe(true);
    expect(out.content).toBe(
      `<input class="x" data-agent-native-prop-value="hi"/>`,
    );
  });

  it("reports no change when the source span is missing", () => {
    const out = applyRootAttributeEdit(html, null, "data-x", "y");
    expect(out.changed).toBe(false);
    expect(out.content).toBe(html);
  });
});
