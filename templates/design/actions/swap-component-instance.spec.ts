import { describe, expect, it } from "vitest";

import action, {
  findOpenTagEnd,
  mergeComponentSwapOverrides,
  reassignCopiedDescendantNodeIds,
  setAttributeOnMarkup,
} from "./swap-component-instance.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("swap-component-instance schema", () => {
  const base = { designId: "design_1", nodeId: "node_1" };

  it("accepts the minimal payload with a target component name", () => {
    expect(
      action.schema.safeParse({
        ...base,
        targetComponentName: "SecondaryButton",
      }).success,
    ).toBe(true);
  });

  it("rejects an empty targetComponentName", () => {
    expect(
      action.schema.safeParse({ ...base, targetComponentName: "" }).success,
    ).toBe(false);
  });

  it("accepts an optional fileId and source revision guard", () => {
    const parsed = action.schema.safeParse({
      ...base,
      targetComponentName: "SecondaryButton",
      fileId: "file_about",
      source: { currentContent: "<div></div>", revision: "2024-01-01" },
    });
    expect(parsed.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findOpenTagEnd
// ---------------------------------------------------------------------------

describe("findOpenTagEnd", () => {
  it("finds the end of a simple opening tag", () => {
    const markup = '<button class="a">Save</button>';
    expect(findOpenTagEnd(markup)).toBe('<button class="a">'.length);
  });

  it("ignores a > inside a quoted attribute value", () => {
    const markup = '<div data-note="a > b" class="x">Hi</div>';
    const end = findOpenTagEnd(markup);
    expect(markup.slice(0, end)).toBe('<div data-note="a > b" class="x">');
  });

  it("handles self-closing tags", () => {
    const markup = '<img src="a.png" />';
    expect(findOpenTagEnd(markup)).toBe(markup.length);
  });
});

// ---------------------------------------------------------------------------
// setAttributeOnMarkup
// ---------------------------------------------------------------------------

describe("setAttributeOnMarkup", () => {
  it("replaces an existing attribute value", () => {
    const markup =
      '<button data-agent-native-prop-variant="solid">Save</button>';
    const result = setAttributeOnMarkup(
      markup,
      "data-agent-native-prop-variant",
      "outline",
    );
    expect(result).toBe(
      '<button data-agent-native-prop-variant="outline">Save</button>',
    );
  });

  it("inserts a missing attribute before the closing >", () => {
    const markup = "<button>Save</button>";
    const result = setAttributeOnMarkup(
      markup,
      "data-agent-native-prop-variant",
      "outline",
    );
    expect(result).toBe(
      '<button data-agent-native-prop-variant="outline">Save</button>',
    );
  });

  it("only touches the opening tag, not text content that looks like an attribute", () => {
    const markup = '<span>data-agent-native-prop-variant="ignored"</span>';
    const result = setAttributeOnMarkup(
      markup,
      "data-agent-native-node-id",
      "n1",
    );
    expect(result).toBe(
      '<span data-agent-native-node-id="n1">data-agent-native-prop-variant="ignored"</span>',
    );
  });
});

// ---------------------------------------------------------------------------
// mergeComponentSwapOverrides
// ---------------------------------------------------------------------------

describe("mergeComponentSwapOverrides", () => {
  it("carries over overrides for prop names both components share", () => {
    const targetMarkup =
      '<button data-agent-native-component="SecondaryButton" ' +
      'data-agent-native-prop-variant="outline" data-agent-native-prop-size="md" ' +
      "x-data=\"{ variant: 'outline', size: 'md' }\">Cancel</button>";

    const currentProps = [
      { name: "variant", value: "solid" },
      { name: "tone", value: "danger" }, // not declared by the target
    ];
    const targetDefaultProps = [
      { name: "variant", value: "outline" },
      { name: "size", value: "md" },
    ];

    const result = mergeComponentSwapOverrides(
      targetMarkup,
      currentProps,
      targetDefaultProps,
      "btn1",
    );

    // "variant" was overridden onto the new markup.
    expect(result.markup).toContain('data-agent-native-prop-variant="solid"');
    // "size" was not overridden by the caller — keeps the target's default.
    expect(result.markup).toContain('data-agent-native-prop-size="md"');
    // The selected instance's stable node id is stamped onto the result.
    expect(result.markup).toContain('data-agent-native-node-id="btn1"');
    // The target's own x-data is left untouched (not merged).
    expect(result.markup).toContain(
      "x-data=\"{ variant: 'outline', size: 'md' }\"",
    );

    expect(result.overriddenProps).toEqual(["variant"]);
    expect(result.droppedProps).toEqual(["tone"]);
    expect(result.defaultedProps).toEqual(["size"]);
  });

  it("reports every current prop as dropped when the target declares none of them", () => {
    const targetMarkup = '<div data-agent-native-component="Card">Body</div>';
    const currentProps = [{ name: "tone", value: "info" }];
    const result = mergeComponentSwapOverrides(
      targetMarkup,
      currentProps,
      [],
      "card1",
    );
    expect(result.overriddenProps).toEqual([]);
    expect(result.droppedProps).toEqual(["tone"]);
    expect(result.markup).not.toContain("data-agent-native-prop-tone");
    expect(result.markup).toContain('data-agent-native-node-id="card1"');
  });

  it("re-keys copied descendants while preserving the selected root id", () => {
    const targetMarkup =
      '<article data-agent-native-node-id="source-root" data-agent-native-component="Card">' +
      '<h2 data-agent-native-node-id="source-title">Title</h2>' +
      '<div><span data-agent-native-node-id="source-label">Label</span></div>' +
      "</article>";

    let sequence = 0;
    const rekeyed = reassignCopiedDescendantNodeIds(
      targetMarkup,
      () => `fresh-${++sequence}`,
    );
    expect(rekeyed).toContain('data-agent-native-node-id="source-root"');
    expect(rekeyed).toContain('data-agent-native-node-id="fresh-1"');
    expect(rekeyed).toContain('data-agent-native-node-id="fresh-2"');
    expect(rekeyed).toContain('data-agent-native-node-id="fresh-3"');
    expect(rekeyed).not.toContain("source-title");
    expect(rekeyed).not.toContain("source-label");

    const result = mergeComponentSwapOverrides(rekeyed, [], [], "selected");
    expect(result.markup).toContain('data-agent-native-node-id="selected"');
    expect(result.markup).not.toContain(
      'data-agent-native-node-id="source-root"',
    );
  });
});
