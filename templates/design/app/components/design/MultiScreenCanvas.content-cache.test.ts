import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  getCachedScreenContentNode,
  pruneResolvedMetadataCache,
  pruneScreenContentCache,
  resolveScreenMetadataCached,
} from "./multi-screen/screen-content-cache";
import type { FrameGeometry } from "./multi-screen/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScreen(id: string, content: string) {
  return { id, filename: `${id}.html`, content };
}

function makeMetadata(
  overrides: Partial<{
    source: "localhost" | "fusion" | "inline";
    previewState: "live" | "snapshot" | "preview";
    title: string | undefined;
    width: number;
    height: number;
    previewUrl: string | undefined;
  }> = {},
) {
  return {
    source: "inline" as const,
    previewState: "preview" as const,
    width: 1280,
    height: 2560,
    ...overrides,
  };
}

function makeGeometry(overrides: Partial<FrameGeometry> = {}): FrameGeometry {
  return { x: 0, y: 0, width: 320, height: 640, ...overrides };
}

/** Fake renderScreenContent that returns a fresh (unique-identity) node per
 *  call and records its calls, so tests can assert both node identity reuse
 *  and that the underlying render was actually skipped on cache hits. */
function makeRender() {
  const calls: unknown[][] = [];
  const render = (screen: unknown, metadata: unknown, geometry: unknown) => {
    calls.push([screen, metadata, geometry]);
    return Object.freeze({ renderCall: calls.length }) as unknown as ReactNode;
  };
  return { render, calls };
}

// ---------------------------------------------------------------------------
// getCachedScreenContentNode (PF21 — screenContentById per-screen cache)
// ---------------------------------------------------------------------------

describe("getCachedScreenContentNode", () => {
  it("retains an evicted screen's cached node and prunes it only on deletion", () => {
    const cache = new Map();
    const { render, calls } = makeRender();
    const screen = makeScreen("s1", "<html>a</html>");
    const metadata = makeMetadata();
    const geometry = makeGeometry();
    const first = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      geometry,
      render,
    );

    // LRU eviction removes the mounted iframe, not this lightweight content
    // descriptor. A revisit therefore reuses the identical React node.
    pruneScreenContentCache(cache, new Set(["s1"]));
    const revisited = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      geometry,
      render,
    );
    expect(revisited).toBe(first);
    expect(calls).toHaveLength(1);

    pruneScreenContentCache(cache, new Set());
    expect(cache.has("s1")).toBe(false);
    void getCachedScreenContentNode(cache, screen, metadata, geometry, render);
    expect(calls).toHaveLength(2);
  });

  it("returns the identical node for unchanged inputs and renders only once", () => {
    const cache = new Map();
    const { render, calls } = makeRender();
    const screen = makeScreen("s1", "<html>a</html>");
    const metadata = makeMetadata();
    const geometry = makeGeometry();

    const first = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      geometry,
      render,
    );
    const second = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      geometry,
      render,
    );

    expect(second).toBe(first);
    expect(calls.length).toBe(1);
  });

  it("reuses the cached node when only geometry x/y change (move-drag)", () => {
    const cache = new Map();
    const { render, calls } = makeRender();
    const screen = makeScreen("s1", "<html>a</html>");
    const metadata = makeMetadata();

    const first = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      makeGeometry({ x: 0, y: 0 }),
      render,
    );
    const afterMove = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      makeGeometry({ x: 481.5, y: -217.25 }),
      render,
    );

    expect(afterMove).toBe(first);
    expect(calls.length).toBe(1);
  });

  it("reuses the cached node when width/height jitter rounds to the same int", () => {
    const cache = new Map();
    const { render, calls } = makeRender();
    const screen = makeScreen("s1", "<html>a</html>");
    const metadata = makeMetadata();

    const first = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      makeGeometry({ width: 320, height: 640 }),
      render,
    );
    const jittered = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      makeGeometry({ width: 320.4, height: 639.6 }),
      render,
    );

    expect(jittered).toBe(first);
    expect(calls.length).toBe(1);
  });

  it("regenerates when the rounded width or height actually changes (resize)", () => {
    const cache = new Map();
    const { render, calls } = makeRender();
    const screen = makeScreen("s1", "<html>a</html>");
    const metadata = makeMetadata();

    const first = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      makeGeometry({ width: 320 }),
      render,
    );
    const resized = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      makeGeometry({ width: 480 }),
      render,
    );

    expect(resized).not.toBe(first);
    expect(calls.length).toBe(2);
    // And the new size is itself cached.
    const resizedAgain = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      makeGeometry({ width: 480 }),
      render,
    );
    expect(resizedAgain).toBe(resized);
    expect(calls.length).toBe(2);
  });

  it("regenerates when the screen object changes (content edit)", () => {
    const cache = new Map();
    const { render, calls } = makeRender();
    const metadata = makeMetadata();
    const geometry = makeGeometry();

    const first = getCachedScreenContentNode(
      cache,
      makeScreen("s1", "<html>a</html>"),
      metadata,
      geometry,
      render,
    );
    const afterEdit = getCachedScreenContentNode(
      cache,
      makeScreen("s1", "<html>b</html>"),
      metadata,
      geometry,
      render,
    );

    expect(afterEdit).not.toBe(first);
    expect(calls.length).toBe(2);
  });

  it("compares metadata by value, not identity", () => {
    const cache = new Map();
    const { render, calls } = makeRender();
    const screen = makeScreen("s1", "<html>a</html>");
    const geometry = makeGeometry();

    const first = getCachedScreenContentNode(
      cache,
      screen,
      makeMetadata(),
      geometry,
      render,
    );
    // Fresh-but-value-equal metadata object (resolveScreenMetadataCached
    // normally guarantees a stable object, but the content cache must not
    // depend on that) → still a hit.
    const equalMetadata = getCachedScreenContentNode(
      cache,
      screen,
      makeMetadata(),
      geometry,
      render,
    );
    expect(equalMetadata).toBe(first);
    expect(calls.length).toBe(1);

    // A real metadata change (e.g. preview URL appears) → regenerate.
    const changedMetadata = getCachedScreenContentNode(
      cache,
      screen,
      makeMetadata({ previewUrl: "http://localhost:3000/" }),
      geometry,
      render,
    );
    expect(changedMetadata).not.toBe(first);
    expect(calls.length).toBe(2);
  });

  it("renders once per preview-state renderer identity and caches each result", () => {
    const cache = new Map();
    const a = makeRender();
    const b = makeRender();
    const screen = makeScreen("s1", "<html>a</html>");
    const metadata = makeMetadata();
    const geometry = makeGeometry();

    const first = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      geometry,
      a.render,
    );
    const afterCallbackChange = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      geometry,
      b.render,
    );

    expect(afterCallbackChange).not.toBe(first);
    expect(a.calls.length).toBe(1);
    expect(b.calls.length).toBe(1);

    const afterCallbackChangeAgain = getCachedScreenContentNode(
      cache,
      screen,
      metadata,
      geometry,
      b.render,
    );
    expect(afterCallbackChangeAgain).toBe(afterCallbackChange);
    expect(b.calls.length).toBe(1);
  });

  it("caches screens independently — one screen's change never touches siblings", () => {
    const cache = new Map();
    const { render, calls } = makeRender();
    const metadata = makeMetadata();
    const screenA = makeScreen("a", "<html>a</html>");
    const screenB = makeScreen("b", "<html>b</html>");

    const nodeA = getCachedScreenContentNode(
      cache,
      screenA,
      metadata,
      makeGeometry(),
      render,
    );
    const nodeB = getCachedScreenContentNode(
      cache,
      screenB,
      metadata,
      makeGeometry({ x: 400 }),
      render,
    );
    expect(calls.length).toBe(2);

    // Resize A only: B's cached node survives untouched.
    const nodeA2 = getCachedScreenContentNode(
      cache,
      screenA,
      metadata,
      makeGeometry({ width: 500 }),
      render,
    );
    const nodeB2 = getCachedScreenContentNode(
      cache,
      screenB,
      metadata,
      makeGeometry({ x: 400 }),
      render,
    );
    expect(nodeA2).not.toBe(nodeA);
    expect(nodeB2).toBe(nodeB);
    expect(calls.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// resolveScreenMetadataCached (PF20 — per-screen resolveScreenMetadata memo)
// ---------------------------------------------------------------------------

describe("resolveScreenMetadataCached", () => {
  it("returns the identical result object for unchanged inputs", () => {
    const cache = new Map();
    const screen = makeScreen("s1", "<html>hello</html>");

    const first = resolveScreenMetadataCached(
      cache,
      screen,
      undefined,
      undefined,
      "none",
    );
    const second = resolveScreenMetadataCached(
      cache,
      screen,
      undefined,
      undefined,
      "none",
    );

    expect(second).toBe(first);
  });

  it("recomputes when the screen object (content) changes", () => {
    const cache = new Map();
    const first = resolveScreenMetadataCached(
      cache,
      makeScreen("s1", "<html>hello</html>"),
      undefined,
      undefined,
      "none",
    );
    const second = resolveScreenMetadataCached(
      cache,
      makeScreen("s1", "http://localhost:3000/"),
      undefined,
      undefined,
      "none",
    );

    expect(second).not.toBe(first);
    // The recompute is real: localhost content flips the derived source.
    expect(first.source).toBe("inline");
    expect(second.source).toBe("localhost");
  });

  it("treats fresh-but-value-equal metadata inputs as cache hits", () => {
    const cache = new Map();
    const screen = makeScreen("s1", "<html>hello</html>");

    // DesignEditor's getScreenMetadata-style callers build a fresh object
    // literal per call — identity comparison alone would never hit.
    const first = resolveScreenMetadataCached(
      cache,
      screen,
      { title: "Home", width: 390 },
      undefined,
      "none",
    );
    const second = resolveScreenMetadataCached(
      cache,
      screen,
      { title: "Home", width: 390 },
      undefined,
      "none",
    );

    expect(second).toBe(first);
    expect(first.title).toBe("Home");
    expect(first.width).toBe(390);
  });

  it("recomputes when a metadata input value actually changes", () => {
    const cache = new Map();
    const screen = makeScreen("s1", "<html>hello</html>");

    const first = resolveScreenMetadataCached(
      cache,
      screen,
      { title: "Home" },
      undefined,
      "none",
    );
    const second = resolveScreenMetadataCached(
      cache,
      screen,
      { title: "Pricing" },
      undefined,
      "none",
    );

    expect(second).not.toBe(first);
    expect(second.title).toBe("Pricing");
  });

  it("recomputes when legacy status changes the preview state", () => {
    const cache = new Map();
    const screen = makeScreen("s1", "<html>hello</html>");
    const first = resolveScreenMetadataCached(
      cache,
      screen,
      { status: "preview" },
      undefined,
      "none",
    );
    const second = resolveScreenMetadataCached(
      cache,
      screen,
      { status: "live" },
      undefined,
      "none",
    );

    expect(second).not.toBe(first);
    expect(first.previewState).toBe("preview");
    expect(second.previewState).toBe("live");
  });

  it("prunes metadata for screens removed from the board", () => {
    const cache = new Map([
      ["live", {} as never],
      ["deleted", {} as never],
    ]);

    pruneResolvedMetadataCache(cache, new Set(["live"]));

    expect([...cache.keys()]).toEqual(["live"]);
  });

  it("recomputes when previewDeviceFrame changes", () => {
    const cache = new Map();
    const screen = makeScreen("s1", "<html>hello</html>");

    const none = resolveScreenMetadataCached(
      cache,
      screen,
      undefined,
      undefined,
      "none",
    );
    const mobile = resolveScreenMetadataCached(
      cache,
      screen,
      undefined,
      undefined,
      "mobile",
    );

    expect(mobile).not.toBe(none);
    expect(mobile.width).not.toBe(none.width);
    // And the new device frame is itself cached.
    const mobileAgain = resolveScreenMetadataCached(
      cache,
      screen,
      undefined,
      undefined,
      "mobile",
    );
    expect(mobileAgain).toBe(mobile);
  });
});
