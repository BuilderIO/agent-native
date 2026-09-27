import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../shared/code-layer.js";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_NAME_ATTR,
  isComponentInstance,
} from "../shared/component-model.js";
import {
  applyComponentAnnotations,
  createComponentSourceMatches,
  deriveComponentPropStamps,
  isLinkedComponentDescendant,
  normalizeComponentName,
  setAttributeOnOpenTag,
} from "./create-component.js";

describe("createComponentSourceMatches", () => {
  const live = {
    content: '<main data-agent-native-node-id="root"></main>',
    versionHash: "live-hash",
  };

  it("accepts an exact editor preimage", () => {
    expect(
      createComponentSourceMatches(live, {
        currentContent: live.content,
        expectedVersionHash: live.versionHash,
      }),
    ).toBe(true);
  });

  it("rejects changed source content", () => {
    expect(
      createComponentSourceMatches(live, {
        currentContent: "<main>newer</main>",
        expectedVersionHash: live.versionHash,
      }),
    ).toBe(false);
  });

  it("rejects a stale source hash even when content matches", () => {
    expect(
      createComponentSourceMatches(live, {
        currentContent: live.content,
        expectedVersionHash: "stale-hash",
      }),
    ).toBe(false);
  });
});

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

  it("stamps a stable opaque main identity without changing its name or props", () => {
    const html =
      '<button data-agent-native-node-id="button-1" data-variant="outline" aria-pressed="true">Go</button>';
    const projection = buildCodeLayerProjection(html, {
      source: {
        kind: "design-file",
        designId: "design-1",
        fileId: "screen-1",
      },
    });
    const node = projection.nodes[0];
    expect(node).toBeTruthy();
    if (!node) return;
    const id = "cmp-opaque-test-id";
    const first = applyComponentAnnotations(
      html,
      node,
      "PrimaryButton",
      deriveComponentPropStamps(node),
      id,
    );
    const projected = buildCodeLayerProjection(first.content, {
      source: projection.source,
    }).nodes[0];
    expect(first.changed).toBe(true);
    expect(projected?.dataAttributes[COMPONENT_ID_ATTR]).toBe(id);
    expect(projected?.dataAttributes[COMPONENT_NAME_ATTR]).toBe(
      "PrimaryButton",
    );
    expect(projected?.dataAttributes["data-agent-native-prop-variant"]).toBe(
      "outline",
    );
    expect(projected?.dataAttributes["data-agent-native-prop-pressed"]).toBe(
      "true",
    );
    const second = applyComponentAnnotations(
      first.content,
      projected!,
      "PrimaryButton",
      deriveComponentPropStamps(projected!),
      id,
    );
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });
});

describe("isLinkedComponentDescendant", () => {
  const source = {
    kind: "design-file" as const,
    designId: "design-1",
    fileId: "screen-1",
  };

  it("rejects nodes nested below a canonical component main", () => {
    const projection = buildCodeLayerProjection(
      '<main data-agent-native-node-id="main-root" data-agent-native-component-id="cmp-1"><button data-agent-native-node-id="child">Go</button></main>',
      { source },
    );
    const main = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "main-root",
    );
    const child = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "child",
    );
    expect(main).toBeTruthy();
    expect(child).toBeTruthy();
    if (!main || !child) return;
    expect(isLinkedComponentDescendant(main, projection)).toBe(false);
    expect(isLinkedComponentDescendant(child, projection)).toBe(true);
  });

  it("rejects nodes nested below a linked instance while leaving ordinary nodes eligible", () => {
    const projection = buildCodeLayerProjection(
      '<section data-agent-native-node-id="instance-root" data-agent-native-component-ref="cmp-1"><button data-agent-native-node-id="instance-child">Go</button></section><p data-agent-native-node-id="ordinary">Text</p>',
      { source },
    );
    const instanceChild = projection.nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === "instance-child",
    );
    const ordinary = projection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "ordinary",
    );
    expect(instanceChild).toBeTruthy();
    expect(ordinary).toBeTruthy();
    if (!instanceChild || !ordinary) return;
    expect(isLinkedComponentDescendant(instanceChild, projection)).toBe(true);
    expect(isLinkedComponentDescendant(ordinary, projection)).toBe(false);
  });
});
