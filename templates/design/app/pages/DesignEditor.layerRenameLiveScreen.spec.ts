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

describe("layer rename on a running-app screen", () => {
  it("corrupts the stored route URL when the runtime node is written into it", () => {
    const corrupted = setCodeLayerAttributeInHtml(
      ROUTE_URL,
      runtimeHeroNode(),
      "data-agent-native-layer-name",
      "Renamed",
    );
    expect(corrupted).not.toBe(ROUTE_URL);
    expect(corrupted).toContain('data-agent-native-layer-name="Renamed"');
    expect(corrupted).not.toContain("/about");
  });

  it("writes cleanly when given the live snapshot instead", () => {
    const renamed = setCodeLayerAttributeInHtml(
      RUNTIME_HTML,
      runtimeHeroNode(),
      "data-agent-native-layer-name",
      "Renamed",
    );
    expect(renamed).toContain('data-agent-native-layer-name="Renamed"');
    expect(renamed).toContain("Hero");
    expect(renamed).toContain("<section");
    expect(renamed).not.toContain("https://");
  });
});
