import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { validateCompiledNativeHtml } from "../native-artifact-reassembly.js";
import { parseNativeCreativeArtifact } from "../native-artifact.js";
import { compileGoogleSlidesPresentation } from "./google-slides-native.js";
import { normalizeContextItem } from "./normalize.js";

const presentation = JSON.parse(
  readFileSync(
    new URL("./fixtures/google-slides-native.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("Google Slides native compiler", () => {
  it("compiles realistic API JSON into editable bounded HTML with explicit fidelity", async () => {
    const resolveAsset = vi.fn(async () => ({
      id: `ccm_${"a".repeat(28)}`,
      kind: "image" as const,
      mimeType: "image/png",
      accessMode: "private" as const,
      storageKey: "creative-context-blob:v1:fixture-image",
      contentHash: "image-hash",
      url: `/_agent-native/creative-context/media?mediaId=ccm_${"a".repeat(28)}`,
    }));
    const resolveFallback = vi.fn(async () => ({
      id: `ccm_${"b".repeat(28)}`,
      kind: "image" as const,
      mimeType: "image/png",
      accessMode: "private" as const,
      storageKey: "creative-context-blob:v1:fixture-fallback",
      contentHash: "fallback-hash",
      url: `/_agent-native/creative-context/media?mediaId=ccm_${"b".repeat(28)}`,
    }));

    const [slide] = await compileGoogleSlidesPresentation(presentation, {
      presentationId: "fixture-deck-2026",
      revisionId: "revision-42",
      resolveAsset,
      resolveFallback,
    });

    expect(slide).toBeDefined();
    expect(slide!.html).toContain('class="fmd-slide google-slides-native"');
    expect(slide!.html).toContain("matrix(1,0,0.1,1,48,264)");
    expect(slide!.html).toContain("border-radius:50%");
    expect(slide!.html).toContain("<table");
    expect(slide!.html).toContain("Revenue &lt;script&gt;");
    expect(slide!.html).not.toContain("<script>");
    expect(slide!.html).not.toMatch(/https?:\/\//);
    expect(slide!.html).toContain(
      `src="/_agent-native/creative-context/media?mediaId=ccm_${"a".repeat(28)}"`,
    );
    expect(slide!.html).toContain('data-source-object-id="word-art-1"');
    expect(slide!.html).toContain("gslide-image-fallback");
    expect(slide!.plainText).toContain("Revenue <script>alert('x')</script>");
    expect(slide!.lexicalText).toContain("gslide-shape");
    expect(Buffer.byteLength(slide!.html, "utf8")).toBeLessThanOrEqual(
      128 * 1024,
    );
    expect(resolveAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        slideObjectId: "slide-1",
        elementObjectId: "image-1",
        kind: "image",
      }),
    );
    expect(resolveFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        elementObjectId: "word-art-1",
        reason: expect.stringContaining("WordArt"),
      }),
    );
    expect(parseNativeCreativeArtifact(slide!.nativeArtifact)).toMatchObject({
      schemaVersion: 1,
      app: "slides",
      format: "slides-html",
      rootExternalId: "fixture-deck-2026:slide-1",
      fidelityReport: {
        exact: { count: 6 },
        approximated: { count: 0, reasons: [] },
        imageFallback: {
          count: 1,
          reasons: [expect.objectContaining({ nodeId: "word-art-1" })],
        },
      },
    });
    expect(slide!.media).toHaveLength(2);
  });

  it("fails closed when an indivisible element cannot receive a localized fallback", async () => {
    await expect(
      compileGoogleSlidesPresentation(presentation, {
        presentationId: "fixture-deck-2026",
        revisionId: "revision-42",
        resolveAsset: async () => ({
          id: `ccm_${"a".repeat(28)}`,
          kind: "image",
          accessMode: "private",
          storageKey: "creative-context-blob:v1:image",
          url: `/_agent-native/creative-context/media?mediaId=ccm_${"a".repeat(28)}`,
        }),
        resolveFallback: async () => null,
      }),
    ).rejects.toThrow(
      "Localized raster fallback for word-art-1 was unavailable",
    );
  });

  it("produces a new content hash for resync while preserving prior version evidence", async () => {
    const revised = structuredClone(presentation);
    const revisedSlides = revised.slides as Array<Record<string, any>>;
    revisedSlides[0]!.pageElements[0]!.shape.text.textElements[1]!.textRun.content =
      "Updated revenue";
    const resolveAsset = async () => ({
      id: `ccm_${"a".repeat(28)}`,
      kind: "image" as const,
      accessMode: "private" as const,
      storageKey: "creative-context-blob:v1:image",
      url: `/_agent-native/creative-context/media?mediaId=ccm_${"a".repeat(28)}`,
    });
    const resolveFallback = async () => ({
      id: `ccm_${"b".repeat(28)}`,
      kind: "image" as const,
      accessMode: "private" as const,
      storageKey: "creative-context-blob:v1:fallback",
      url: `/_agent-native/creative-context/media?mediaId=ccm_${"b".repeat(28)}`,
    });
    const [[first], [second]] = await Promise.all([
      compileGoogleSlidesPresentation(presentation, {
        presentationId: "fixture-deck-2026",
        revisionId: "revision-42",
        resolveAsset,
        resolveFallback,
      }),
      compileGoogleSlidesPresentation(revised, {
        presentationId: "fixture-deck-2026",
        revisionId: "revision-43",
        resolveAsset,
        resolveFallback,
      }),
    ]);
    const versionOne = normalizeContextItem({
      externalId: "fixture-deck-2026:slide-1",
      kind: "google-slides-slide",
      title: "Slide",
      mimeType: "text/html",
      content: first!.html,
      sourceVersion: "revision-42",
    });
    const versionTwo = normalizeContextItem({
      externalId: "fixture-deck-2026:slide-1",
      kind: "google-slides-slide",
      title: "Slide",
      mimeType: "text/html",
      content: second!.html,
      sourceVersion: "revision-43",
    });

    expect(versionOne.contentHash).not.toBe(versionTwo.contentHash);
    expect(versionOne.content).toContain("Revenue &lt;script&gt;");
    expect(versionOne.content).not.toContain("Updated revenue");
    expect(versionTwo.content).toContain("Updated revenue");
  });

  it("preserves native HTML whitespace before immutable hashing", () => {
    const html =
      '<div class="fmd-slide google-slides-native"><span>Two  spaces</span>\n  <span>Indented</span></div>';
    const item = normalizeContextItem({
      externalId: "deck:slide",
      kind: "google-slides-slide",
      title: "Whitespace",
      mimeType: "text/html",
      content: html,
      metadata: {
        nativeArtifact: {
          format: "slides-html",
        },
      },
      chunks: [{ ordinal: 0, text: "Two spaces Indented" }],
    });

    expect(item.content).toBe(html);
  });

  it("handles real inheritance, nested transforms, crop/effects, and honest fallback reasons", async () => {
    const fallbackRequests: Array<{
      elementObjectId: string;
      bounds: { x: number; y: number; width: number; height: number };
      reason: string;
    }> = [];
    const [slide] = await compileGoogleSlidesPresentation(
      {
        pageSize: {
          width: { magnitude: 960, unit: "PX" },
          height: { magnitude: 540, unit: "PX" },
        },
        masters: [
          {
            objectId: "master",
            pageProperties: {
              colorScheme: {
                colors: [
                  {
                    type: "ACCENT1",
                    color: {
                      rgbColor: { red: 0.2, green: 0.4, blue: 0.6 },
                    },
                  },
                ],
              },
            },
            pageElements: [
              {
                objectId: "master-title",
                size: {
                  width: { magnitude: 400, unit: "PX" },
                  height: { magnitude: 80, unit: "PX" },
                },
                shape: {
                  shapeType: "TEXT_BOX",
                  placeholder: { type: "TITLE", index: 0 },
                  text: {
                    textElements: [
                      {
                        paragraphMarker: {
                          style: { alignment: "START" },
                        },
                      },
                      {
                        textRun: {
                          content: "Master",
                          style: {
                            fontSize: { magnitude: 24, unit: "PT" },
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
        layouts: [
          {
            objectId: "layout",
            layoutProperties: { masterObjectId: "master" },
            pageElements: [
              {
                objectId: "layout-title",
                shape: {
                  shapeType: "TEXT_BOX",
                  placeholder: {
                    type: "TITLE",
                    index: 0,
                    parentObjectId: "master-title",
                  },
                  text: {
                    textElements: [
                      { paragraphMarker: { style: {} } },
                      {
                        textRun: {
                          content: "Layout",
                          style: {
                            weightedFontFamily: {
                              fontFamily: "Inter",
                              weight: 600,
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
        slides: [
          {
            objectId: "adversarial",
            slideProperties: { layoutObjectId: "layout" },
            pageProperties: {
              pageBackgroundFill: {
                stretchedPictureFill: {
                  contentUrl: "https://assets.example.test/background.png",
                },
              },
            },
            pageElements: [
              {
                objectId: "title",
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  translateX: 20,
                  translateY: 20,
                  unit: "PX",
                },
                shape: {
                  shapeType: "TEXT_BOX",
                  placeholder: {
                    type: "TITLE",
                    index: 0,
                    parentObjectId: "layout-title",
                  },
                  text: {
                    textElements: [
                      {
                        paragraphMarker: {
                          style: { alignment: "END" },
                        },
                      },
                      {
                        textRun: {
                          content: "<Inherited & escaped>",
                          style: { bold: true },
                        },
                      },
                    ],
                  },
                },
              },
              {
                objectId: "cropped-image",
                title: "Photo & chart",
                size: {
                  width: { magnitude: 200, unit: "PX" },
                  height: { magnitude: 100, unit: "PX" },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  shearX: 0.25,
                  translateX: 500,
                  translateY: 30,
                  unit: "PX",
                },
                image: {
                  contentUrl: "https://assets.example.test/image.png",
                  imageProperties: {
                    cropProperties: { leftOffset: 0.25 },
                    transparency: 0.2,
                    brightness: 0.1,
                    contrast: -0.2,
                  },
                },
              },
              {
                objectId: "bordered-table",
                size: {
                  width: { magnitude: 200, unit: "PX" },
                  height: { magnitude: 80, unit: "PX" },
                },
                table: {
                  horizontalBorderRows: [{}],
                  tableRows: [
                    {
                      tableCells: [
                        {
                          text: {
                            textElements: [{ textRun: { content: "Cell" } }],
                          },
                        },
                      ],
                    },
                  ],
                },
              },
              {
                objectId: "scaled-group",
                size: {
                  width: { magnitude: 200, unit: "PX" },
                  height: { magnitude: 100, unit: "PX" },
                },
                transform: {
                  scaleX: 2,
                  scaleY: 2,
                  translateX: 100,
                  translateY: 50,
                  unit: "PX",
                },
                elementGroup: {
                  children: [
                    {
                      objectId: "nested-word-art",
                      size: {
                        width: { magnitude: 40, unit: "PX" },
                        height: { magnitude: 20, unit: "PX" },
                      },
                      transform: {
                        scaleX: 1,
                        scaleY: 1,
                        translateX: 20,
                        translateY: 30,
                        unit: "PX",
                      },
                      wordArt: { renderedText: "Nested" },
                    },
                  ],
                },
              },
              {
                objectId: "arrow-line",
                size: {
                  width: { magnitude: 100, unit: "PX" },
                  height: { magnitude: 10, unit: "PX" },
                },
                line: {
                  lineType: "STRAIGHT_CONNECTOR_1",
                  lineProperties: { endArrow: "ARROW" },
                },
              },
            ],
          },
        ],
      },
      {
        presentationId: "adversarial-deck",
        revisionId: "v1",
        resolveAsset: async () => ({
          id: `ccm_${"a".repeat(28)}`,
          kind: "image",
          accessMode: "private",
          storageKey: "creative-context-blob:v1:image",
          url: `/_agent-native/creative-context/media?mediaId=ccm_${"a".repeat(28)}`,
        }),
        resolveFallback: async (request) => {
          fallbackRequests.push(request);
          return {
            id: `ccm_${"b".repeat(28)}`,
            kind: "image",
            accessMode: "private",
            storageKey: "creative-context-blob:v1:fallback",
            url: `/_agent-native/creative-context/media?mediaId=ccm_${"b".repeat(28)}`,
          };
        },
      },
    );

    expect(slide!.html).toContain("&lt;Inherited &amp; escaped&gt;");
    expect(slide!.html).toContain("font-family:'Inter'");
    expect(slide!.html).toContain("font-size:32px");
    expect(slide!.html).toContain("font-weight:600");
    expect(slide!.html).toContain("color:#336699");
    expect(slide!.html).toContain("left:-33.333%");
    expect(slide!.html).toContain("opacity:0.8");
    expect(slide!.html).toContain("brightness(1.1) contrast(0.8)");
    expect(fallbackRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementObjectId: "nested-word-art",
          bounds: { x: 140, y: 110, width: 80, height: 40 },
        }),
        expect.objectContaining({
          elementObjectId: "arrow-line",
          reason: expect.stringContaining("arrowed"),
        }),
      ]),
    );
    expect(slide!.nativeArtifact.fidelityReport).toMatchObject({
      exact: { count: 2 },
      approximated: {
        count: 3,
        reasons: expect.arrayContaining([
          expect.objectContaining({
            nodeId: "adversarial:background",
            nodeType: "pageBackground",
          }),
          expect.objectContaining({ nodeId: "cropped-image" }),
          expect.objectContaining({ nodeId: "bordered-table" }),
        ]),
      },
      imageFallback: { count: 2 },
    });
  });

  it("inherits a directly referenced master font and renders omitted zero-scale line axes", async () => {
    const [slide] = await compileGoogleSlidesPresentation(
      {
        pageSize: {
          width: { magnitude: 960, unit: "PX" },
          height: { magnitude: 540, unit: "PX" },
        },
        masters: [
          {
            objectId: "master",
            pageElements: [
              {
                objectId: "master-title",
                size: {
                  width: { magnitude: 300, unit: "PX" },
                  height: { magnitude: 100, unit: "PX" },
                },
                transform: { scaleX: 2, scaleY: 0.5, unit: "PX" },
                shape: {
                  shapeType: "TEXT_BOX",
                  placeholder: { type: "TITLE" },
                  text: {
                    textElements: [
                      { paragraphMarker: { style: { lineSpacing: 90 } } },
                      {
                        textRun: {
                          content: "Master title\n",
                          style: {
                            fontFamily: "Fixture Sans",
                            weightedFontFamily: {
                              fontFamily: "Fixture Sans",
                              weight: 700,
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
              {
                objectId: "grid",
                transform: { scaleX: 1, scaleY: 1, unit: "PX" },
                elementGroup: {
                  children: [
                    {
                      objectId: "vertical-grid-line",
                      size: {
                        width: { magnitude: 100, unit: "PX" },
                        height: { magnitude: 100, unit: "PX" },
                      },
                      transform: {
                        scaleY: -5.4,
                        translateX: 120,
                        translateY: 540,
                        unit: "PX",
                      },
                      line: {
                        lineType: "STRAIGHT_CONNECTOR_1",
                        lineProperties: {
                          dashStyle: "SOLID",
                          startArrow: "NONE",
                          endArrow: "NONE",
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
        layouts: [
          {
            objectId: "layout",
            layoutProperties: { masterObjectId: "master" },
            pageElements: [],
          },
        ],
        slides: [
          {
            objectId: "slide",
            slideProperties: {
              layoutObjectId: "layout",
              masterObjectId: "master",
            },
            pageElements: [
              {
                objectId: "slide-title",
                shape: {
                  shapeType: "TEXT_BOX",
                  placeholder: {
                    type: "TITLE",
                    parentObjectId: "master-title",
                  },
                  text: {
                    textElements: [
                      { paragraphMarker: { style: { lineSpacing: 100 } } },
                      {
                        textRun: {
                          content: "Inherited title",
                          style: {
                            foregroundColor: {
                              opaqueColor: {
                                rgbColor: { red: 1, green: 1, blue: 1 },
                              },
                            },
                            fontSize: { magnitude: 39, unit: "PT" },
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
      },
      {
        presentationId: "direct-master-fixture",
        resolveAsset: async () => {
          throw new Error("fixture has no image assets");
        },
      },
    );

    expect(slide!.html).toContain("font-family:'Fixture Sans'");
    expect(slide!.html).toContain("font-weight:700");
    expect(slide!.html).toContain("font-size:52px");
    expect(slide!.html).toContain("rotate(-90deg)");
    expect(slide!.html).toContain("translate(120px,540px)");
  });

  it("splits oversized slides into immutable native parts and localizes an indivisible oversized element", async () => {
    const pageElements = Array.from({ length: 700 }, (_, index) => ({
      objectId: `rect-${index}`,
      size: {
        width: { magnitude: 10, unit: "PX" },
        height: { magnitude: 10, unit: "PX" },
      },
      transform: {
        translateX: index % 100,
        translateY: index % 50,
        unit: "PX",
      },
      shape: { shapeType: "RECT" },
    }));
    const [split] = await compileGoogleSlidesPresentation(
      { slides: [{ objectId: "large-slide", pageElements }] },
      {
        presentationId: "large-deck",
        revisionId: "v1",
        resolveAsset: async () => {
          throw new Error("fixture has no image assets");
        },
      },
    );

    expect(split!.childArtifacts).toHaveLength(700);
    expect(split!.nativeArtifact.manifest?.children).toHaveLength(700);
    expect(Buffer.byteLength(split!.html, "utf8")).toBeLessThanOrEqual(
      128 * 1024,
    );
    validateCompiledNativeHtml(split!.html, split!.nativeArtifact);
    for (const child of split!.childArtifacts) {
      expect(Buffer.byteLength(child.html, "utf8")).toBeLessThanOrEqual(
        128 * 1024,
      );
      validateCompiledNativeHtml(child.html, child.nativeArtifact);
    }

    const resolveFallback = vi.fn(async () => ({
      id: `ccm_${"b".repeat(28)}`,
      kind: "image" as const,
      accessMode: "private" as const,
      storageKey: "creative-context-blob:v1:fallback",
      url: `/_agent-native/creative-context/media?mediaId=ccm_${"b".repeat(28)}`,
    }));
    const [localized] = await compileGoogleSlidesPresentation(
      {
        slides: [
          {
            objectId: "indivisible-slide",
            pageElements: [
              {
                objectId: "huge-text",
                size: {
                  width: { magnitude: 900, unit: "PX" },
                  height: { magnitude: 500, unit: "PX" },
                },
                shape: {
                  shapeType: "TEXT_BOX",
                  text: {
                    textElements: [
                      { textRun: { content: "x".repeat(140 * 1024) } },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
      {
        presentationId: "indivisible-deck",
        revisionId: "v1",
        resolveAsset: async () => {
          throw new Error("fixture has no image assets");
        },
        resolveFallback,
      },
    );

    expect(localized!.childArtifacts).toHaveLength(0);
    expect(Buffer.byteLength(localized!.html, "utf8")).toBeLessThanOrEqual(
      128 * 1024,
    );
    expect(resolveFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        elementObjectId: "huge-text",
        reason: expect.stringContaining("inline artifact budget"),
      }),
    );
    expect(localized!.nativeArtifact.fidelityReport).toMatchObject({
      imageFallback: {
        count: 1,
        reasons: [expect.objectContaining({ nodeId: "huge-text" })],
      },
    });
  });
});
