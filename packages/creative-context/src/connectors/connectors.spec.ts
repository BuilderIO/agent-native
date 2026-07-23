import { describe, expect, it, vi } from "vitest";

const ssrfSafeFetch = vi.hoisted(() =>
  vi.fn(
    async () =>
      new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+oWG9WQAAAABJRU5ErkJggg==",
          "base64",
        ),
        {
          status: 200,
          headers: { "content-type": "image/png" },
        },
      ),
  ),
);

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch,
  isBlockedExtensionUrlWithDns: vi.fn(async () => false),
}));

import {
  createDefaultContextImportConnectorRegistry,
  GoogleSlidesContextConnector,
  ManualContextConnector,
  NotionContextConnector,
  registerDefaultCreativeContextConnectors,
  UploadContextConnector,
} from "./index.js";
import { connectorConnectionId } from "./provider-response.js";
import type { ContextConnectorExecutionContext } from "./types.js";

function context(
  executeRequest: (input: Record<string, unknown>) => Promise<unknown>,
): ContextConnectorExecutionContext {
  return {
    appId: "slides",
    resolveConnection: async () => "connection-1",
    providerApi: { executeRequest } as never,
  };
}

describe("creative context connectors", () => {
  it("allows admin-token fallback only for Figma", async () => {
    await expect(
      connectorConnectionId("notion", { credentialMode: "admin-token" }),
    ).rejects.toThrow(/per-user granted workspace connection/i);
    await expect(
      connectorConnectionId("google_drive", { useAdminToken: true }),
    ).rejects.toThrow(/admin-token mode is not allowed/i);
    await expect(
      connectorConnectionId("figma", { credentialMode: "admin-token" }),
    ).resolves.toBeUndefined();
  });
  it("registers the six default connectors idempotently", () => {
    const registry = createDefaultContextImportConnectorRegistry();
    expect(registry.list().map((connector) => connector.kind)).toEqual([
      "figma",
      "google-slides",
      "manual",
      "notion",
      "upload",
      "website",
    ]);
    expect(() =>
      registerDefaultCreativeContextConnectors(registry),
    ).not.toThrow();
    expect(registry.list()).toHaveLength(6);
  });

  it("captures Drive access restrictions and propagates them to each slide", async () => {
    const executeRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).endsWith("/thumbnail")) {
        return {
          contentUrl: "https://lh3.googleusercontent.com/slide-1.png",
          width: 200,
          height: 113,
        };
      }
      if (input.provider === "google_drive") {
        return {
          files: [
            {
              id: "deck-1",
              name: "Launch deck",
              modifiedTime: "2026-06-10T12:00:00.000Z",
              webViewLink: "https://docs.google.com/presentation/d/deck-1/edit",
              shared: true,
              capabilities: { canCopy: false, canDownload: false },
              permissions: [
                { type: "domain", role: "reader", allowFileDiscovery: false },
              ],
            },
          ],
        };
      }
      return {
        title: "Launch deck",
        revisionId: "revision-7",
        masters: [
          {
            objectId: "master-1",
            pageProperties: {
              pageBackgroundFill: { solidFill: { color: "navy" } },
            },
            pageElements: [
              {
                objectId: "master-title",
                shape: {
                  placeholder: { type: "TITLE", index: 0 },
                  text: {
                    textElements: [
                      {
                        textRun: {
                          content: "Master title",
                          style: {
                            fontFamily: "Aptos",
                            fontSize: { magnitude: 22, unit: "PT" },
                            foregroundColor: {
                              opaqueColor: {
                                rgbColor: { red: 1, green: 0, blue: 0 },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
        layouts: [
          {
            objectId: "layout-1",
            layoutProperties: { masterObjectId: "master-1" },
            pageElements: [
              {
                objectId: "layout-title",
                shape: {
                  placeholder: {
                    type: "TITLE",
                    index: 0,
                    parentObjectId: "master-title",
                  },
                  text: {
                    textElements: [
                      {
                        textRun: {
                          content: "Layout title",
                          style: { fontFamily: "Inter" },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
        slides: [
          {
            objectId: "slide-1",
            slideProperties: {
              layoutObjectId: "layout-1",
              notesPage: {
                pageElements: [
                  {
                    shape: {
                      text: {
                        textElements: [{ textRun: { content: "Say this" } }],
                      },
                    },
                  },
                ],
              },
            },
            pageElements: [
              {
                objectId: "slide-title",
                shape: {
                  placeholder: {
                    type: "TITLE",
                    index: 0,
                    parentObjectId: "layout-title",
                  },
                  text: {
                    textElements: [
                      {
                        textRun: {
                          content: "The launch",
                          style: {
                            fontSize: { magnitude: 30, unit: "PT" },
                            foregroundColor: {
                              opaqueColor: { themeColor: "ACCENT1" },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      };
    });
    const connector = new GoogleSlidesContextConnector();
    const putPrivateBlob = vi.fn(async () => ({
      id: "slide-thumbnail-1",
      provider: "fixture",
      opaque: true as const,
      encrypted: true,
      mimeType: "image/png",
    }));
    const executionContext = {
      ...context(executeRequest),
      ownerEmail: "owner@example.com",
      putPrivateBlob,
    };
    const inventory = await connector.inventory(
      { sourceId: "source-1", config: { folderId: "folder-1" } },
      executionContext,
    );

    expect(inventory.items[0]).toMatchObject({
      externalId: "deck-1",
      upstreamAccess: "restricted",
      metadata: {
        accessSignals: {
          shared: true,
          capabilities: { canCopy: false, canDownload: false },
        },
      },
    });
    expect(executeRequest.mock.calls[0]?.[0]).toMatchObject({
      provider: "google_drive",
      connectionId: "connection-1",
    });

    const fetched = await connector.fetch(
      {
        sourceId: "source-1",
        config: { folderId: "folder-1" },
        item: inventory.items[0],
      },
      executionContext,
    );
    expect(fetched.items[0]).toMatchObject({
      externalId: "deck-1",
      kind: "google-slides-presentation",
      parseStatus: "parsed",
      sourceVersion: "revision-7",
      metadata: {
        slideCount: 1,
        childExternalIds: ["deck-1:slide-1"],
      },
      edges: [
        {
          relation: "contains-slide",
          toExternalId: "deck-1:slide-1",
        },
      ],
    });
    const slide = fetched.items.find(
      (item) => item.externalId === "deck-1:slide-1",
    );
    expect(slide).toMatchObject({
      externalId: "deck-1:slide-1",
      upstreamAccess: "restricted",
      curationStatus: "review",
      sourceVersion: "revision-7",
      metadata: {
        speakerNotes: expect.stringContaining("Say this"),
        theme: {
          masterObjectId: "master-1",
          layoutObjectId: "layout-1",
          fontFamilies: ["Inter"],
          fontSizes: ["30PT"],
          colors: expect.arrayContaining(["theme:ACCENT1"]),
          placeholders: [
            expect.objectContaining({
              objectId: "slide-title",
              layoutObjectId: "layout-title",
              masterObjectId: "master-title",
              inheritedFrom: ["master", "layout", "slide"],
            }),
          ],
        },
      },
      thumbnailBlobRef: expect.stringContaining("creative-context-blob:v1:"),
      media: [
        expect.objectContaining({
          kind: "image",
          accessMode: "private",
          width: 200,
          height: 113,
          metadata: expect.objectContaining({ boundedUiThumbnail: true }),
        }),
      ],
    });
    expect(slide?.content).toContain("The launch");
    expect(executeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/presentations/deck-1/pages/slide-1/thumbnail",
        query: expect.objectContaining({
          "thumbnailProperties.thumbnailSize": "SMALL",
        }),
      }),
    );
    expect(putPrivateBlob).toHaveBeenCalledTimes(1);
  });

  it("uses confirmed presentation ids as an exact Slides inventory boundary", async () => {
    const executeRequest = vi.fn(async (input: Record<string, unknown>) => ({
      id: String(input.path).split("/").at(-1),
      name: "Confirmed deck",
      mimeType: "application/vnd.google-apps.presentation",
      modifiedTime: "2026-07-15T00:00:00.000Z",
    }));
    const inventory = await new GoogleSlidesContextConnector().inventory(
      {
        sourceId: "source-1",
        config: { presentationIds: ["deck-a", "deck-b"] },
      },
      context(executeRequest),
    );

    expect(inventory.items.map((item) => item.externalId)).toEqual([
      "deck-a",
      "deck-b",
    ]);
    expect(executeRequest).toHaveBeenCalledTimes(2);
    expect(executeRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: "/files/deck-a" }),
    );
  });

  it("discards the temporary full-slide render after storing only a localized fallback crop", async () => {
    const executeRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).endsWith("/thumbnail")) {
        return {
          contentUrl: "https://lh3.googleusercontent.com/temporary-render.png",
          width: 1,
          height: 1,
        };
      }
      return {
        title: "Fallback deck",
        pageSize: {
          width: { magnitude: 1, unit: "PX" },
          height: { magnitude: 1, unit: "PX" },
        },
        slides: [
          {
            objectId: "slide-fallback",
            pageElements: [
              {
                objectId: "word-art",
                size: {
                  width: { magnitude: 1, unit: "PX" },
                  height: { magnitude: 1, unit: "PX" },
                },
                wordArt: { renderedText: "Fallback" },
              },
            ],
          },
        ],
      };
    });
    const putPrivateBlob = vi.fn(async () => ({
      id: "localized-crop",
      provider: "fixture",
      opaque: true as const,
      encrypted: true,
      mimeType: "image/png",
    }));

    const fetched = await new GoogleSlidesContextConnector().fetch(
      {
        sourceId: "source-1",
        config: {
          presentationIds: ["deck-fallback"],
          hydrateThumbnails: false,
        },
        item: {
          externalId: "deck-fallback",
          kind: "google-slides-presentation",
          title: "Fallback deck",
          sourceModifiedAt: "2026-07-16T12:00:00.000Z",
        },
      },
      {
        ...context(executeRequest),
        ownerEmail: "owner@example.com",
        putPrivateBlob,
      },
    );

    const slide = fetched.items.find(
      (item) => item.externalId === "deck-fallback:slide-fallback",
    );
    expect(slide).toMatchObject({
      sourceVersion: "2026-07-16T12:00:00.000Z",
      media: [
        expect.objectContaining({
          width: 1,
          height: 1,
          metadata: expect.objectContaining({
            localizedFallback: true,
            elementObjectId: "word-art",
          }),
        }),
      ],
    });
    expect(slide?.thumbnailBlobRef).toBeUndefined();
    expect(putPrivateBlob).toHaveBeenCalledTimes(1);
    expect(executeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/presentations/deck-fallback/pages/slide-fallback/thumbnail",
        query: expect.objectContaining({
          "thumbnailProperties.thumbnailSize": "LARGE",
        }),
      }),
    );
  });

  it("verifies ownership only when every explicitly bounded Slides file is authoritatively owned", () => {
    const connector = new GoogleSlidesContextConnector();
    const inventory = [
      {
        externalId: "deck-a",
        kind: "google-slides-presentation",
        title: "Deck A",
        metadata: { accessSignals: { ownedByMe: true } },
      },
      {
        externalId: "deck-b",
        kind: "google-slides-presentation",
        title: "Deck B",
        metadata: { accessSignals: { ownedByMe: true } },
      },
    ];

    expect(
      connector.verifiesContainerOwner({
        config: { presentationIds: ["deck-a", "deck-b"] },
        inventory,
      }),
    ).toBe(true);
    expect(
      connector.verifiesContainerOwner({
        config: { presentationIds: ["deck-a", "deck-b", "deck-c"] },
        inventory,
      }),
    ).toBe(false);
    expect(
      connector.verifiesContainerOwner({
        config: { folderId: "folder-a" },
        inventory,
      }),
    ).toBe(false);
    expect(
      connector.verifiesContainerOwner({
        config: { presentationIds: ["deck-a", "deck-b"] },
        inventory: inventory.map((item, index) =>
          index === 0
            ? item
            : {
                ...item,
                metadata: { accessSignals: { ownedByMe: false } },
              },
        ),
      }),
    ).toBe(false);
  });

  it("requires explicit Notion roots, recursively chunks headings, and preserves unknown sharing", async () => {
    const connector = new NotionContextConnector();
    const executeRequest = vi.fn(async (input: Record<string, unknown>) => {
      if (String(input.path).startsWith("/pages/")) {
        const pageId = String(input.path).split("/").at(-1)!;
        return {
          id: pageId,
          url: `https://www.notion.so/${pageId}`,
          last_edited_time:
            pageId === "page-1"
              ? "2026-07-01T00:00:00.000Z"
              : "2026-07-02T00:00:00.000Z",
          properties: {
            Name: {
              type: "title",
              title: [
                {
                  plain_text:
                    pageId === "page-1" ? "Brand voice" : "Voice examples",
                },
              ],
            },
          },
        };
      }
      if (input.path === "/blocks/page-1/children") {
        return {
          results: [
            {
              id: "image-1",
              type: "image",
              image: {
                file: {
                  url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/expiring-brand.png",
                },
              },
              has_children: false,
            },
            {
              id: "heading-1",
              type: "heading_1",
              heading_1: { rich_text: [{ plain_text: "Voice" }] },
              has_children: true,
            },
            {
              id: "child-page-1",
              type: "child_page",
              child_page: { title: "Voice examples" },
              has_children: true,
            },
          ],
          has_more: false,
        };
      }
      if (input.path === "/blocks/child-page-1/children") {
        return {
          results: [
            {
              id: "child-paragraph-1",
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: "A separate child-page example." }],
              },
              has_children: false,
            },
          ],
          has_more: false,
        };
      }
      return {
        results: [
          {
            id: "paragraph-1",
            type: "paragraph",
            paragraph: { rich_text: [{ plain_text: "Clear and warm." }] },
            has_children: false,
          },
        ],
        has_more: false,
      };
    });
    const putPrivateBlob = vi.fn(async () => ({
      id: "notion-media-1",
      provider: "fixture",
      opaque: true as const,
      encrypted: true,
      mimeType: "image/png",
    }));
    const executionContext = {
      ...context(executeRequest),
      ownerEmail: "owner@example.com",
      putPrivateBlob,
    };

    await expect(
      connector.inventory(
        { sourceId: "source-1", config: {} },
        executionContext,
      ),
    ).rejects.toThrow(/requires rootPageIds/i);
    const inventory = await connector.inventory(
      { sourceId: "source-1", config: { rootPageIds: ["page-1"] } },
      executionContext,
    );
    expect(inventory.items.map((item) => item.externalId)).toEqual([
      "page-1",
      "child-page-1",
    ]);
    expect(inventory.items[1]?.metadata).toMatchObject({
      selectedRootPageId: "page-1",
      parentPageId: "page-1",
      depth: 1,
    });
    expect(inventory.items[0]?.upstreamAccess).toBe("unknown");
    const fetched = await connector.fetch(
      {
        sourceId: "source-1",
        config: { rootPageIds: ["page-1"] },
        item: inventory.items[0],
      },
      executionContext,
    );
    expect(fetched.items[0]).toMatchObject({
      title: "Brand voice",
      upstreamAccess: "unknown",
      curationStatus: "included",
      sourceVersion: "2026-07-01T00:00:00.000Z",
      media: [
        expect.objectContaining({
          kind: "image",
          accessMode: "private",
          provenanceUrl:
            "https://prod-files-secure.s3.us-west-2.amazonaws.com/expiring-brand.png",
        }),
      ],
      edges: [
        expect.objectContaining({
          relation: "contains-page",
          toExternalId: "child-page-1",
        }),
      ],
    });
    expect(fetched.items[0]?.content).toContain("# Voice");
    expect(fetched.items[0]?.content).toContain("Clear and warm.");
    expect(fetched.items[0]?.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "notion-section",
          metadata: { heading: "Voice", headingLevel: 1 },
        }),
      ]),
    );
    expect(putPrivateBlob).toHaveBeenCalledTimes(1);

    const child = await connector.fetch(
      {
        sourceId: "source-1",
        config: { rootPageIds: ["page-1"] },
        item: inventory.items[1],
      },
      executionContext,
    );
    expect(child.items[0]).toMatchObject({
      externalId: "child-page-1",
      title: "Voice examples",
      content: expect.stringContaining("A separate child-page example."),
      edges: [
        expect.objectContaining({
          relation: "parent-page",
          toExternalId: "page-1",
        }),
      ],
    });
  });

  it("normalizes manual context end to end with stable content evidence", async () => {
    const connector = new ManualContextConnector();
    const config = {
      items: [
        {
          id: "voice-guide",
          title: "Voice guide",
          text: "Clear, warm, and concise.",
          summary: "Brand voice",
          metadata: { canonical: true },
        },
      ],
    };
    const inventory = await connector.inventory(
      { sourceId: "source-1", config },
      { appId: "content" },
    );
    const fetched = await connector.fetch(
      { sourceId: "source-1", config, item: inventory.items[0] },
      { appId: "content" },
    );
    expect(fetched.items[0]).toMatchObject({
      externalId: "voice-guide",
      kind: "manual-document",
      title: "Voice guide",
      content: "Clear, warm, and concise.",
      summary: "Brand voice",
      metadata: { canonical: true },
    });
    expect(fetched.items[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps PPTX slides, DOCX sections, and PDF pages independently addressable with their raw snapshot", async () => {
    const connector = new UploadContextConnector();
    const config = {
      items: [
        { id: "deck", title: "Deck", extractedText: "fixture" },
        { id: "brief", title: "Brief", extractedText: "fixture" },
        { id: "report", title: "Report", extractedText: "fixture" },
      ],
    };
    const inventory = await connector.inventory(
      { sourceId: "source-1", config },
      { appId: "slides" },
    );
    const kinds = {
      deck: { parser: "pptx", kind: "slide", title: "Slide 1" },
      brief: { parser: "docx", kind: "section", title: "Overview" },
      report: { parser: "pdf", kind: "page", title: "Page 1" },
    } as const;
    const fetched = await Promise.all(
      inventory.items.map((item) =>
        connector.fetch(
          { sourceId: "source-1", config, item },
          {
            appId: "slides",
            loadUpload: (async () => {
              const fixture = kinds[item.externalId as keyof typeof kinds];
              return {
                text: `${fixture.title} text`,
                title: item.title,
                documentTitle: item.title,
                parser: fixture.parser,
                parts: [
                  {
                    kind: fixture.kind,
                    index: 0,
                    title: fixture.title,
                    text: `${fixture.title} text`,
                  },
                ],
                metadata: {
                  privateBlobRef: `creative-context-blob:v1:${item.externalId}`,
                  contentHash: `${item.externalId}-hash`,
                },
              };
            }) as never,
          },
        ),
      ),
    );
    expect(fetched.flatMap((result) => result.items)).toEqual([
      expect.objectContaining({
        externalId: "deck",
        kind: "uploaded-document",
        parseStatus: "parsed",
        edges: [
          {
            relation: "contains-upload-part",
            toExternalId: "deck:slide-1",
          },
        ],
      }),
      expect.objectContaining({
        externalId: "deck:slide-1",
        kind: "uploaded-slide",
        rawSnapshotBlobRef: "creative-context-blob:v1:deck",
      }),
      expect.objectContaining({
        externalId: "brief",
        kind: "uploaded-document",
        parseStatus: "parsed",
      }),
      expect.objectContaining({
        externalId: "brief:section-1",
        kind: "uploaded-section",
        rawSnapshotBlobRef: "creative-context-blob:v1:brief",
      }),
      expect.objectContaining({
        externalId: "report",
        kind: "uploaded-document",
        parseStatus: "parsed",
      }),
      expect.objectContaining({
        externalId: "report:page-1",
        kind: "uploaded-page",
        rawSnapshotBlobRef: "creative-context-blob:v1:report",
      }),
    ]);
  });
});
