import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../shared/code-layer.js";
import {
  COMPONENT_NAME_ATTR,
  isComponentInstance,
} from "../shared/component-model.js";
import {
  applyComponentAnnotations,
  deriveComponentPropStamps,
  normalizeComponentName,
  setAttributeOnOpenTag,
} from "./create-component.js";

describe("normalizeComponentName", () => {
  it("PascalCases free-form input", () => {
    expect(normalizeComponentName("primary button")).toBe("PrimaryButton");
    expect(normalizeComponentName("hero-card")).toBe("HeroCard");
    expect(normalizeComponentName("  My  Widget 2 ")).toBe("MyWidget2");
  });

  it("falls back to Component for empty/garbage input", () => {
    expect(normalizeComponentName("")).toBe("Component");
    expect(normalizeComponentName("   !!!   ")).toBe("Component");
  });
});

describe("setAttributeOnOpenTag", () => {
  it("inserts a new attribute before the closing bracket", () => {
    expect(setAttributeOnOpenTag("<button>", "data-x", "y")).toBe(
      '<button data-x="y">',
    );
    expect(setAttributeOnOpenTag('<img src="a.png"/>', "data-x", "y")).toBe(
      '<img src="a.png" data-x="y"/>',
    );
  });

  it("replaces an existing attribute value", () => {
    expect(setAttributeOnOpenTag('<div data-x="old">', "data-x", "new")).toBe(
      '<div data-x="new">',
    );
  });

  it("escapes the value", () => {
    expect(setAttributeOnOpenTag("<div>", "data-x", '"<&>"')).toBe(
      '<div data-x="&quot;&lt;&amp;&gt;&quot;">',
    );
  });
});

describe("deriveComponentPropStamps", () => {
  it("maps variant-like data + aria attributes to prop stamps", () => {
    const stamps = deriveComponentPropStamps({
      dataAttributes: {
        "data-variant": "outline",
        "data-size": "lg",
        "data-unrelated": "x",
      },
      attributes: { "aria-pressed": "true" },
    });
    const byName = Object.fromEntries(stamps.map((s) => [s.name, s.value]));
    expect(byName["data-agent-native-prop-variant"]).toBe("outline");
    expect(byName["data-agent-native-prop-size"]).toBe("lg");
    expect(byName["data-agent-native-prop-pressed"]).toBe("true");
    expect(byName["data-agent-native-prop-unrelated"]).toBeUndefined();
  });

  it("treats boolean-true attribute values as 'true'", () => {
    const stamps = deriveComponentPropStamps({
      dataAttributes: {},
      attributes: { "aria-selected": true },
    });
    expect(stamps).toEqual([
      { name: "data-agent-native-prop-selected", value: "true" },
    ]);
  });

  it("returns no stamps when nothing is variant-like", () => {
    expect(
      deriveComponentPropStamps({
        dataAttributes: { "data-foo": "bar" },
        attributes: { id: "x" },
      }),
    ).toEqual([]);
  });
});

describe("applyComponentAnnotations", () => {
  it("stamps the component name + props and is detectable afterwards", () => {
    const html =
      '<!DOCTYPE html><html><body><button data-variant="outline">Go</button></body></html>';
    const projection = buildCodeLayerProjection(html);
    const node = projection.nodes.find((n) => n.tag === "button");
    expect(node).toBeTruthy();
    if (!node) return;

    const stamps = deriveComponentPropStamps(node);
    const { content, changed } = applyComponentAnnotations(
      html,
      node,
      "PrimaryButton",
      stamps,
    );
    expect(changed).toBe(true);
    expect(content).toContain(`${COMPONENT_NAME_ATTR}="PrimaryButton"`);
    expect(content).toContain('data-agent-native-prop-variant="outline"');

    // The re-projected node is now a recognised component instance.
    const reprojected = buildCodeLayerProjection(content);
    const reNode = reprojected.nodes.find((n) => n.tag === "button");
    expect(reNode).toBeTruthy();
    if (reNode) expect(isComponentInstance(reNode)).toBe(true);
  });

  it("is a no-op when the node has no source span", () => {
    const result = applyComponentAnnotations("<x>", { source: null }, "X", []);
    expect(result.changed).toBe(false);
    expect(result.content).toBe("<x>");
  });
});
