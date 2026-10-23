import type { ContextDetail } from "@agent-native/creative-context/types";
import { describe, expect, it } from "vitest";

import { cloneableNativeSlide } from "./clone-context-slide";

function detail(
  content: string,
  compiler = "@agent-native/creative-context:google-slides-native",
) {
  return {
    item: {
      id: "item-1",
      sourceId: "source-1",
      mimeType: "text/html",
      provenance: { compiler },
    },
    version: {
      id: "version-1",
      mimeType: "text/html",
      content,
      metadata: {
        speakerNotes: "Imported note",
        nativeArtifact: {
          schemaVersion: 1,
          app: "slides",
          format: "slides-html",
          rootExternalId: "deck-1:slide-1",
          sourceBounds: { x: 0, y: 0, width: 960, height: 540 },
          fidelityReport: {
            exact: { count: 1 },
            approximated: { count: 0, reasons: [] },
            imageFallback: { count: 0, reasons: [] },
          },
        },
      },
    },
    chunks: [],
    media: [],
    edges: [],
  } as unknown as ContextDetail;
}

describe("clone-context-slide native code gate", () => {
  it("returns the exact pinned compiler output without regeneration", () => {
    const html =
      '<div class="fmd-slide google-slides-native" data-source-slide-id="slide-1" style="position:relative;width:960px;height:540px"><p style="margin:0">Exact code</p></div>';
    expect(cloneableNativeSlide(detail(html))).toEqual({
      content: html,
      notes: "Imported note",
      sourceExternalId: "deck-1:slide-1",
    });
  });

  it("rejects a tampered persisted artifact before deck insertion", () => {
    const html =
      '<div class="fmd-slide google-slides-native" data-source-slide-id="slide-1" style="position:relative;width:960px;height:540px"><script>alert(1)</script></div>';
    expect(() => cloneableNativeSlide(detail(html))).toThrow(
      "executable HTML/CSS",
    );
  });

  it("rejects metadata forged without trusted compiler provenance", () => {
    const html =
      '<div class="fmd-slide google-slides-native" data-source-slide-id="slide-1" style="position:relative;width:960px;height:540px"></div>';
    expect(() => cloneableNativeSlide(detail(html, "attacker"))).toThrow(
      "compiler provenance is untrusted",
    );
  });

  it("accepts a compiler-validated split shell for pinned child reassembly", () => {
    const childExternalId = "deck-1:slide-1:native-part:1";
    const html = `<div class="fmd-slide google-slides-native" data-source-slide-id="slide-1" style="position:relative;width:960px;height:540px"><div data-creative-context-child="${childExternalId}"></div></div>`;
    const context = detail(html) as unknown as {
      version: { metadata: Record<string, any> };
    };
    context.version.metadata.nativeArtifact = {
      ...context.version.metadata.nativeArtifact,
      childExternalIds: [childExternalId],
      manifest: {
        kind: "hierarchical-artboard",
        children: [
          {
            externalId: childExternalId,
            sourceNodeId: "shape-1",
            bounds: { x: 10, y: 20, width: 200, height: 100 },
            zOrder: 0,
          },
        ],
      },
    };

    expect(cloneableNativeSlide(context as never).content).toBe(html);
  });
});
