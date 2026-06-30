import { describe, expect, it } from "vitest";

import action, {
  applyRootAttributeEdit,
  escapeAttributeValue,
} from "./apply-component-prop-edit.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// escapeAttributeValue
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// applyRootAttributeEdit — pure HTML open-tag splice
// ---------------------------------------------------------------------------

describe("applyRootAttributeEdit", () => {
  // `<button …>` open tag is bytes 0..N of this string.
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
    // The element's children are left untouched.
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
    // Inserted before the closing `>` of the open tag only.
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
