import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../../shared/code-layer";
import { setCodeLayerAttributeInHtml } from "./design-editor/html-layer-positioning";

const ROUTE_URL = "https://design.example.com/builder-preview/d1/about";
const RUNTIME_HTML = `<main><section data-agent-native-node-id="hero">Hero</section></main>`;

function runtimeHeroNode() {
  const node = buildCodeLayerProjection(RUNTIME_HTML).nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === "hero",
  );
  expect(node).toBeDefined();
  return node!;
}

describe("lock/hide attribute writes against a route URL", () => {
  it("corrupts the stored URL when a runtime node is written into it", () => {
    const corrupted = setCodeLayerAttributeInHtml(
      ROUTE_URL,
      runtimeHeroNode(),
      "data-agent-native-locked",
      "true",
    );
    expect(corrupted).not.toBe(ROUTE_URL);
    expect(corrupted).toContain('data-agent-native-locked="true"');
    expect(corrupted).not.toContain("/about");
  });

  it("writes cleanly when given the live snapshot instead", () => {
    const next = setCodeLayerAttributeInHtml(
      RUNTIME_HTML,
      runtimeHeroNode(),
      "data-agent-native-hidden",
      "true",
    );
    expect(next).toContain('data-agent-native-hidden="true"');
    expect(next).toContain("<section");
    expect(next).not.toContain("https://");
  });
});
