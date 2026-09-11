import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../../shared/code-layer";
import {
  liveNudgeReorderHandoff,
  nudgeBaseContentForScreen,
  resolveCodeLayerNodeFromElementInfo,
  resolveSelectedCodeLayerNode,
} from "./design-editor/code-layer-state";
import { resolveElementNudgeIntent } from "./design-editor/nudge-intent";

/**
 * Running-app screens (fusion / localhost) store their ROUTE URL in
 * `design_files.content`, not markup. These cover the two DesignEditor call
 * sites that used to read that string as if it were a document: keyboard nudge
 * intent, and canvas-to-Layers-panel selection sync.
 */
const ROUTE_URL = "https://design.example.com/builder-preview/design-1/about";

/** The live DOM the proxied container rendered; ids minted by the bridge. */
const RUNTIME_HTML = `<main><section data-agent-native-node-id="runtime-hero">Hero</section></main>`;

const selectedElement = {
  tagName: "section",
  selector: '[data-agent-native-node-id="runtime-hero"]',
  sourceId: "runtime-hero",
  classes: [],
  computedStyles: {},
  boundingRect: { x: 0, y: 0, width: 10, height: 10 },
  textContent: "Hero",
  isFlexChild: false,
  isFlexContainer: false,
} as never;

function nodeIdOf(
  node: { dataAttributes: Record<string, string> } | null,
): string | undefined {
  return node?.dataAttributes["data-agent-native-node-id"];
}

describe("resolveSelectedCodeLayerNode on a running-app screen", () => {
  // The stored "source" for such a screen is the URL, so its projection is empty.
  const sourceProjection = buildCodeLayerProjection(ROUTE_URL);
  const runtimeProjection = buildCodeLayerProjection(RUNTIME_HTML);

  it("finds no node in the stored route URL, which is the bug's origin", () => {
    expect(sourceProjection.nodes).toHaveLength(0);
    expect(
      resolveCodeLayerNodeFromElementInfo(sourceProjection, selectedElement),
    ).toBeNull();
  });

  it("resolves selection against the projection the Layers panel renders", () => {
    // A non-null id is what makes the panel highlight and auto-expand the row.
    // This was null before the fix, so the layer had to be found by hand.
    expect(
      nodeIdOf(
        resolveSelectedCodeLayerNode({
          selectedElement,
          sourceProjection,
          runtimeProjection,
        }),
      ),
    ).toBe("runtime-hero");
  });

  it("leaves an inline screen resolving against its own source", () => {
    expect(
      nodeIdOf(
        resolveSelectedCodeLayerNode({
          selectedElement,
          sourceProjection: buildCodeLayerProjection(RUNTIME_HTML),
          runtimeProjection: null,
        }),
      ),
    ).toBe("runtime-hero");
  });

  it("returns null without a selection", () => {
    expect(
      resolveSelectedCodeLayerNode({
        selectedElement: null,
        sourceProjection,
        runtimeProjection,
      }),
    ).toBeNull();
  });

  it("falls back to source when the runtime tree lacks the node", () => {
    const staleRuntime = buildCodeLayerProjection(
      `<main><section data-agent-native-node-id="other">Other</section></main>`,
    );
    expect(
      nodeIdOf(
        resolveSelectedCodeLayerNode({
          selectedElement,
          sourceProjection: buildCodeLayerProjection(RUNTIME_HTML),
          runtimeProjection: staleRuntime,
        }),
      ),
    ).toBe("runtime-hero");
  });
});

describe("nudgeBaseContentForScreen", () => {
  it("nudges against the live snapshot, never the stored route URL", () => {
    expect(
      nudgeBaseContentForScreen({
        isRunningApp: true,
        runtimeSnapshotHtml: RUNTIME_HTML,
        liveSnapshotHtml: null,
        sourceContent: ROUTE_URL,
      }),
    ).toBe(RUNTIME_HTML);
  });

  it("prefers the runtime snapshot over the fetched live snapshot", () => {
    expect(
      nudgeBaseContentForScreen({
        isRunningApp: true,
        runtimeSnapshotHtml: RUNTIME_HTML,
        liveSnapshotHtml: "<main>stale</main>",
        sourceContent: ROUTE_URL,
      }),
    ).toBe(RUNTIME_HTML);
  });

  it("falls back to the live snapshot when no runtime snapshot exists", () => {
    expect(
      nudgeBaseContentForScreen({
        isRunningApp: true,
        runtimeSnapshotHtml: null,
        liveSnapshotHtml: RUNTIME_HTML,
        sourceContent: ROUTE_URL,
      }),
    ).toBe(RUNTIME_HTML);
  });

  it("yields empty content before any snapshot arrives, never the URL", () => {
    // Empty makes resolveElementNudgeIntent return a plain translate rather
    // than projecting a URL and silently mis-resolving the flow.
    expect(
      nudgeBaseContentForScreen({
        isRunningApp: true,
        runtimeSnapshotHtml: null,
        liveSnapshotHtml: null,
        sourceContent: ROUTE_URL,
      }),
    ).toBe("");
  });

  it("keeps using stored source content for an inline screen", () => {
    expect(
      nudgeBaseContentForScreen({
        isRunningApp: false,
        runtimeSnapshotHtml: null,
        liveSnapshotHtml: null,
        sourceContent: RUNTIME_HTML,
      }),
    ).toBe(RUNTIME_HTML);
  });
});

/**
 * The reorder half of the nudge fix. `resolveElementNudgeIntent` reports the
 * anchor as a PROJECTION node id, but the live pending-edit pipeline addresses
 * the running document by SELECTOR, so the two have to be bridged or the queued
 * edit anchors against nothing.
 */
describe("liveNudgeReorderHandoff", () => {
  const ROW = `<section data-agent-native-node-id="row" style="display:flex">
    <div data-agent-native-node-id="alpha">Alpha</div>
    <div data-agent-native-node-id="beta">Beta</div>
  </section>`;

  const alpha = {
    tagName: "div",
    sourceId: "alpha",
    selector: '[data-agent-native-node-id="alpha"]',
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
  } as never;

  it("turns a real nudge intent into a selector-addressed live edit", () => {
    const intent = resolveElementNudgeIntent({
      content: ROW,
      selectedElement: alpha,
      direction: "right",
      largeStep: false,
    });
    expect(intent.kind).toBe("reorder");
    if (intent.kind !== "reorder") return;

    const handoff = liveNudgeReorderHandoff({
      content: intent.content,
      anchorNodeId: intent.anchorNodeId,
      placement: intent.placement,
    });

    // The anchor must be addressable in the LIVE document; a projection id
    // never reaches it.
    expect(handoff).not.toBeNull();
    expect(handoff!.anchorSelector).toContain("beta");
    expect(handoff!.anchorSourceId).toBe("beta");
    expect(handoff!.placement).toBe(intent.placement);
  });

  it("returns null for an anchor that is not in the document", () => {
    // Caller drops the keypress rather than queueing an edit anchored to
    // nothing, which would corrupt the pending-edit batch.
    expect(
      liveNudgeReorderHandoff({
        content: ROW,
        anchorNodeId: "no-such-node",
        placement: "after",
      }),
    ).toBeNull();
  });

  it("returns null when the base content is a route URL rather than markup", () => {
    expect(
      liveNudgeReorderHandoff({
        content: ROUTE_URL,
        anchorNodeId: "beta",
        placement: "after",
      }),
    ).toBeNull();
  });

  it("omits anchorSourceId when the anchor carries no bridge id", () => {
    // Projection ids are derived from path/offset when a node has no stable
    // data-agent-native-node-id, so the selector is the only usable address.
    const plain = `<section><div>Alpha</div><div class="beta-row">Beta</div></section>`;
    const projection = buildCodeLayerProjection(plain);
    const anchor = projection.nodes.find((node) =>
      node.classes?.includes("beta-row"),
    );
    expect(anchor).toBeDefined();

    const handoff = liveNudgeReorderHandoff({
      content: plain,
      anchorNodeId: anchor!.id,
      placement: "after",
    });
    expect(handoff).not.toBeNull();
    expect(handoff!.anchorSelector).toBeTruthy();
    expect(handoff!.anchorSourceId).toBeUndefined();
  });
});
