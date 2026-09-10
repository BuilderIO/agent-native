import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection, buildCodeLayerTree } from "./code-layer";
import { isComponentInstance } from "./component-model";

// The decoys from the real "Design system demo" screen. Each is an ordinary
// styled element; none carries data-agent-native-component.
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

    // The annotated <button> plus the plain <button>: form controls are
    // components by a deliberate, consistent rule. No div is.
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
});
