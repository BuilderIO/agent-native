import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../../shared/code-layer";
import { setCodeLayerAttributeInHtml } from "./design-editor/html-layer-positioning";

/**
 * Layer rename on a running-app screen.
 *
 * `setCodeLayerAttributeInHtml` splices by raw source offsets taken from the
 * projection the node came from. For a running-app screen the Layers panel's
 * node comes from the RUNTIME projection while `design_files.content` is the
 * route URL, so writing the node into the stored content does not no-op: it
 * corrupts the URL that is the screen's iframe src.
 */
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
    // Pins the failure mode the guard exists to prevent. Not a desired
    // behavior of the helper: it is why the caller must never hand it the
    // stored content for one of these screens.
    const corrupted = setCodeLayerAttributeInHtml(
      ROUTE_URL,
      runtimeHeroNode(),
      "data-agent-native-layer-name",
      "Renamed",
    );
    expect(corrupted).not.toBe(ROUTE_URL);
    expect(corrupted).toContain('data-agent-native-layer-name="Renamed"');
    // The screen's src is destroyed: the attribute lands mid-path.
    expect(corrupted).not.toContain("/about");
  });

  it("writes cleanly when given the live snapshot instead", () => {
    // What the fixed caller does: resolve the node against the live snapshot
    // and write there, leaving the stored route URL untouched.
    const renamed = setCodeLayerAttributeInHtml(
      RUNTIME_HTML,
      runtimeHeroNode(),
      "data-agent-native-layer-name",
      "Renamed",
    );
    expect(renamed).toContain('data-agent-native-layer-name="Renamed"');
    expect(renamed).toContain("Hero");
    // Still a well-formed document, and the URL was never a participant.
    expect(renamed).toContain("<section");
    expect(renamed).not.toContain("https://");
  });
});
