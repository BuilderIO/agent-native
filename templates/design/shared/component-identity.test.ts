import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection, buildCodeLayerTree } from "./code-layer";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_REF_ATTR,
  instanceFromNode,
  isComponentInstance,
  isComponentInstanceForInstanceActions,
  stableComponentNodeId,
} from "./component-model";

const DECOYS = `<body>
  <button data-agent-native-component="Button" data-agent-native-prop-variant="primary">Real</button>
  <div class="card p-5">a card class</div>
  <button class="cursor-pointer px-4">plain button</button>
  <div class="btn-group flex gap-3"><a href="#">one</a></div>
  <div class="control-panel rounded"><h3>panel</h3></div>
  <div class="product-card-wrapper"><img src="a.png" alt="a" /></div>
  <div class="bg-card text-card-foreground">shadcn utility classes</div>
</body>`;

function componentNames(html: string): string[] {
  const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
  const found: string[] = [];
  const walk = (nodes: typeof tree) => {
    for (const node of nodes) {
      if (node.isComponent) found.push(`${node.tag}.${node.name}`);
      walk(node.children);
    }
  };
  walk(tree);
  return found;
}

describe("component identity is the annotation, not a guess at the class name", () => {
  it("marks the annotated element and the form control, nothing styled like them", () => {
    const marked = componentNames(DECOYS);

    expect(marked.every((name) => name.startsWith("button."))).toBe(true);
    expect(marked).toHaveLength(2);
  });

  it("does not read a class named card, btn, control or component", () => {
    for (const cls of [
      "card",
      "btn-group",
      "control-panel",
      "product-card-wrapper",
      "bg-card",
      "my-component",
    ]) {
      const html = `<body><div class="${cls}">x</div></body>`;
      expect(componentNames(html), cls).toEqual([]);
    }
  });

  it("does not read a user's layer name", () => {
    const html = `<body><div data-agent-native-layer-name="Pricing card">x</div></body>`;
    expect(componentNames(html)).toEqual([]);
  });

  it("still recognises a real annotation with no classes at all", () => {
    const html = `<body><div data-agent-native-component="Hero">x</div></body>`;
    expect(componentNames(html)).toHaveLength(1);
    expect(
      buildCodeLayerProjection(html).nodes.filter(isComponentInstance),
    ).toHaveLength(1);
  });

  it("persists the authored node id instead of the projection id", () => {
    const node = buildCodeLayerProjection(
      '<body><div data-agent-native-node-id="stable-card" data-agent-native-component="Card">x</div></body>',
    ).nodes.find(
      (candidate) => candidate.dataAttributes["data-agent-native-component"],
    );

    expect(node).toBeDefined();
    expect(instanceFromNode(node!)).toMatchObject({
      instanceId: "stable-card",
      nodeId: "stable-card",
    });
  });
});

describe("instance-only component operations", () => {
  it("exclude a canonical main while allowing linked and legacy roots", () => {
    const projection = buildCodeLayerProjection(
      `<body>
        <div data-agent-native-node-id="main" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="cmp-card">Main</div>
        <div data-agent-native-node-id="ref" data-agent-native-component="Card" ${COMPONENT_REF_ATTR}="cmp-card">Reference</div>
        <div data-agent-native-node-id="legacy" data-agent-native-component="Card">Legacy</div>
        <div data-agent-native-node-id="invalid" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="" ${COMPONENT_REF_ATTR}="cmp-card">Invalid</div>
      </body>`,
    );
    const node = (nodeId: string) =>
      projection.nodes.find(
        (candidate) =>
          candidate.dataAttributes["data-agent-native-node-id"] === nodeId,
      )!;

    expect(isComponentInstanceForInstanceActions(node("main"))).toBe(false);
    expect(isComponentInstanceForInstanceActions(node("ref"))).toBe(true);
    expect(isComponentInstanceForInstanceActions(node("legacy"))).toBe(true);
    expect(isComponentInstanceForInstanceActions(node("invalid"))).toBe(false);
  });

  it("keeps component instance identity stable across projection rebuilds", () => {
    const html =
      '<body><button data-agent-native-node-id="cta-1" data-agent-native-component="PrimaryButton">Save</button></body>';
    const first =
      buildCodeLayerProjection(html).nodes.find(isComponentInstance);
    const second = first ? { ...first, id: "projection-new-id" } : undefined;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.id).not.toBe(second?.id);
    expect(stableComponentNodeId(first!)).toBe("cta-1");
    expect(stableComponentNodeId(second!)).toBe("cta-1");
    expect(instanceFromNode(first!)?.instanceId).toBe("cta-1");
    expect(instanceFromNode(second!)?.nodeId).toBe("cta-1");
  });
});
