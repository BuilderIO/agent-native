import { describe, expect, it, vi } from "vitest";

import { reassembleNativeCreativeArtifact } from "./native-artifact-reassembly.js";
import type { ContextDetail } from "./types.js";

const fidelityReport = {
  exact: { count: 1 },
  approximated: { count: 0, reasons: [] },
  imageFallback: { count: 0, reasons: [] },
};

function detail(input: {
  itemId: string;
  externalId: string;
  versionId: string;
  html: string;
  childExternalId?: string;
  pinnedChild?: { itemId: string; itemVersionId: string };
  trusted?: boolean;
  app?: "design" | "slides";
  format?: "design-html" | "slides-html";
}): ContextDetail {
  const app = input.app ?? "design";
  const format = input.format ?? "design-html";
  return {
    item: {
      id: input.itemId,
      sourceId: "source-1",
      externalId: input.externalId,
      kind: "figma-frame",
      title: input.externalId,
      canonicalUrl: null,
      mimeType: "text/html",
      currentVersionId: input.versionId,
      status: "active",
      upstreamAccess: "available",
      curationStatus: "included",
      curationRank: "normal",
      starred: false,
      inventoryState: "available",
      indexState: "indexed",
      tags: [],
      colors: [],
      sortOrder: 0,
      parentItemId: null,
      provenance: {
        compiler:
          input.trusted === false
            ? "user-authored"
            : app === "slides"
              ? "@agent-native/creative-context:google-slides-native"
              : "@agent-native/core/ingestion:figma-node-to-html",
      },
      thumbnailBlobRef: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    version: {
      id: input.versionId,
      itemId: input.itemId,
      versionNumber: 1,
      contentHash: `hash-${input.versionId}`,
      title: input.externalId,
      content: input.html,
      summary: null,
      mimeType: "text/html",
      sourceModifiedAt: null,
      sourceVersion: "figma-version-42",
      rawSnapshotBlobRef: null,
      parseStatus: "parsed",
      parseError: null,
      metadata: {
        nativeArtifact: {
          schemaVersion: 1,
          app,
          format,
          rootExternalId: input.externalId,
          ...(input.childExternalId
            ? {
                childExternalIds: [input.childExternalId],
                manifest: {
                  kind: "hierarchical-artboard",
                  children: [
                    {
                      externalId: input.childExternalId,
                      sourceNodeId: "2:1",
                      bounds: { x: 10, y: 20, width: 200, height: 100 },
                      zOrder: 0,
                    },
                  ],
                },
              }
            : {}),
          fidelityReport,
        },
      },
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    chunks: [],
    media: [],
    edges:
      input.childExternalId && input.pinnedChild
        ? [
            {
              id: "edge-child",
              fromItemId: input.itemId,
              fromItemVersionId: input.versionId,
              toItemId: input.pinnedChild.itemId,
              toItemVersionId: input.pinnedChild.itemVersionId,
              toExternalId: input.childExternalId,
              relation: "contains-native-child",
              metadata: {},
            },
          ]
        : [],
  };
}

describe("native creative artifact reassembly", () => {
  it("reassembles immutable child code and preserves child head resources", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      childExternalId: "file:2:1",
      html: `<!doctype html><html><head><style>.root{color:red}</style></head><body><div class="root"><div data-creative-context-child="file:2:1"></div></div></body></html>`,
    });
    const child = detail({
      itemId: "item-child",
      externalId: "file:2:1",
      versionId: "version-child",
      html: `<!doctype html><html><head><style>.child{color:blue}</style></head><body><div class="child">Exact child</div></body></html>`,
    });
    const resolveChild = vi.fn(async () => child);

    const result = await reassembleNativeCreativeArtifact({
      root,
      app: "design",
      format: "design-html",
      resolveChild,
    });

    expect(resolveChild).toHaveBeenCalledWith({
      sourceId: "source-1",
      externalId: "file:2:1",
      sourceVersion: "figma-version-42",
    });
    expect(result.html).toContain('<div class="child">Exact child</div>');
    expect(result.html).toContain(".child{color:blue}");
    expect(result.evidence).toEqual([
      { itemId: "item-root", itemVersionId: "version-root" },
      { itemId: "item-child", itemVersionId: "version-child" },
    ]);
  });

  it("derives placement and stacking from the immutable manifest, not placeholder markup", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      childExternalId: "file:2:1",
      html: `<!doctype html><html><head></head><body><div><div data-creative-context-child="file:2:1" style="position:absolute;left:999px;top:888px;z-index:777"></div></div></body></html>`,
    });
    const child = detail({
      itemId: "item-child",
      externalId: "file:2:1",
      versionId: "version-child",
      html: `<!doctype html><html><head></head><body><div>Placed child</div></body></html>`,
    });

    const result = await reassembleNativeCreativeArtifact({
      root,
      app: "design",
      format: "design-html",
      resolveChild: async () => child,
    });

    expect(result.html).toContain(
      "position:absolute;left:10px;top:20px;width:200px;height:100px;z-index:0",
    );
    expect(result.html).not.toContain("999px");
    expect(result.html).not.toContain("z-index:777");
  });

  it("reassembles Slides-native fragments without double-applying their source position", async () => {
    const root = detail({
      itemId: "slide-root",
      externalId: "deck:slide",
      versionId: "slide-root-version",
      childExternalId: "deck:slide:native-part:1",
      app: "slides",
      format: "slides-html",
      html: `<div class="fmd-slide google-slides-native"><div class="google-slides-source-canvas"><div data-creative-context-child="deck:slide:native-part:1"></div></div></div>`,
    });
    const child = detail({
      itemId: "slide-child",
      externalId: "deck:slide:native-part:1",
      versionId: "slide-child-version",
      app: "slides",
      format: "slides-html",
      html: `<div class="gslide-element" data-source-object-id="shape-1" style="position:absolute;left:0;top:0;transform:matrix(1,0,0,1,100,50)">Native child</div>`,
    });

    const result = await reassembleNativeCreativeArtifact({
      root,
      app: "slides",
      format: "slides-html",
      resolveChild: async () => child,
    });

    expect(result.html).toContain("transform:matrix(1,0,0,1,100,50)");
    expect(result.html).not.toContain(
      "position:absolute;left:10px;top:20px;width:200px;height:100px",
    );
  });

  it("rejects code that was not emitted by a trusted compiler", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      html: "<!doctype html><html><head></head><body>unsafe</body></html>",
      trusted: false,
    });
    await expect(
      reassembleNativeCreativeArtifact({
        root,
        app: "design",
        format: "design-html",
        resolveChild: async () => null,
      }),
    ).rejects.toThrow("trusted native artifact compiler");
  });

  it("rejects tampered executable markup despite trusted metadata", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      html: `<!doctype html><html><head></head><body><img src="javascript:alert(1)" onerror="alert(1)" /></body></html>`,
    });
    await expect(
      reassembleNativeCreativeArtifact({
        root,
        app: "design",
        format: "design-html",
        resolveChild: async () => null,
      }),
    ).rejects.toThrow("executable HTML/CSS");
  });

  it("rejects external CSS asset fetches that bypass ordinary url() syntax", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      html: `<!doctype html><html><head></head><body><div style="background-image:-webkit-image-set('https://attacker.example/pixel' 1x)">Tampered</div></body></html>`,
    });
    await expect(
      reassembleNativeCreativeArtifact({
        root,
        app: "design",
        format: "design-html",
        resolveChild: async () => null,
      }),
    ).rejects.toThrow(/external or executable URL|URL-bearing construct/);
  });

  it("rejects code whose placeholders do not match the signed manifest shape", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      childExternalId: "file:2:1",
      html: `<!doctype html><html><head></head><body><div data-creative-context-child="file:other"></div></body></html>`,
    });
    await expect(
      reassembleNativeCreativeArtifact({
        root,
        app: "design",
        format: "design-html",
        resolveChild: async () => null,
      }),
    ).rejects.toThrow("does not match its child manifest");
  });

  it("resolves manifest children through exact pinned edge versions", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      childExternalId: "file:2:1",
      pinnedChild: {
        itemId: "item-child",
        itemVersionId: "version-child-1",
      },
      html: `<!doctype html><html><head></head><body><div><div data-creative-context-child="file:2:1"></div></div></body></html>`,
    });
    const child = detail({
      itemId: "item-child",
      externalId: "file:2:1",
      versionId: "version-child-1",
      html: `<!doctype html><html><head></head><body><div>Child v1</div></body></html>`,
    });
    const resolveChild = vi.fn(async () => child);

    const result = await reassembleNativeCreativeArtifact({
      root,
      app: "design",
      format: "design-html",
      resolveChild,
    });

    expect(resolveChild).toHaveBeenCalledWith({
      sourceId: "source-1",
      externalId: "file:2:1",
      itemId: "item-child",
      itemVersionId: "version-child-1",
    });
    expect(result.html).toContain("Child v1");
  });

  it("fails closed when a pinned manifest child loses access", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      childExternalId: "file:2:1",
      pinnedChild: {
        itemId: "item-child",
        itemVersionId: "version-child-1",
      },
      html: `<!doctype html><html><head></head><body><div><div data-creative-context-child="file:2:1"></div></div></body></html>`,
    });

    await expect(
      reassembleNativeCreativeArtifact({
        root,
        app: "design",
        format: "design-html",
        resolveChild: async () => null,
      }),
    ).rejects.toThrow("unavailable at the pinned source version");
  });

  it.each([
    '<img src="/_agent-native/creative-context/media?mediaId=ccm_aaaaaaaaaaaaaaaaaaaaaaaaaaaa" srcset="https://attacker.example/pixel 2x" />',
    "<div x-init=\"fetch('https://attacker.example/pixel')\">Tampered</div>",
    "<div style=\"background-image:image-set('/_agent-native/creative-context/media?mediaId=ccm_aaaaaaaaaaaaaaaaaaaaaaaaaaaa' 1x)\">Tampered</div>",
  ])(
    "rejects tampered executable or alternate-fetch markup: %s",
    async (body) => {
      const root = detail({
        itemId: "item-root",
        externalId: "file:1:1",
        versionId: "version-root",
        html: `<!doctype html><html><head></head><body>${body}</body></html>`,
      });
      await expect(
        reassembleNativeCreativeArtifact({
          root,
          app: "design",
          format: "design-html",
          resolveChild: async () => null,
        }),
      ).rejects.toThrow(/executable framework|URL-bearing|asset references/);
    },
  );

  it("rejects a private media substitution that is not declared by the compiler", async () => {
    const root = detail({
      itemId: "item-root",
      externalId: "file:1:1",
      versionId: "version-root",
      html: `<!doctype html><html><head></head><body><img src="/_agent-native/creative-context/media?mediaId=ccm_aaaaaaaaaaaaaaaaaaaaaaaaaaaa" /></body></html>`,
    });
    await expect(
      reassembleNativeCreativeArtifact({
        root,
        app: "design",
        format: "design-html",
        resolveChild: async () => null,
      }),
    ).rejects.toThrow("declared asset references");
  });
});
