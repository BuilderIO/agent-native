import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../../shared/code-layer";
import { setCodeLayerAttributeInHtml } from "./design-editor/html-layer-positioning";

/**
 * Lock/hide on a running-app screen with no live snapshot.
 *
 * `handleToggleLayerLocked` / `handleToggleLayerHidden` fall back to stored
 * content when `liveScreenSnapshotsById` has no entry for the screen. A fusion
 * screen never populates that map (it tracks a runtime projection instead), so
 * the fallback hands a ROUTE URL to `setCodeLayerAttributeInHtml`, which splices
 * by raw source offsets and lands the attribute mid-path — destroying the
 * screen's iframe src exactly as the rename path did before it was guarded.
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

describe("lock/hide attribute writes against a route URL", () => {
  it("corrupts the stored URL when a runtime node is written into it", () => {
    // Pins the failure mode, and is why the caller must refuse before writing.
    const corrupted = setCodeLayerAttributeInHtml(
      ROUTE_URL,
      runtimeHeroNode(),
      "data-agent-native-locked",
      "true",
    );
    expect(corrupted).not.toBe(ROUTE_URL);
    expect(corrupted).toContain('data-agent-native-locked="true"');
    // The path is broken: the attribute lands inside it.
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
