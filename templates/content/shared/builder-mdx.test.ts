import { describe, expect, it } from "vitest";

import {
  builderBlocksHash,
  builderEntryToMdxBundle,
  builderEntryToReadableMdxBundle,
  builderReadableBodyToBuilderBlocks,
  builderMdxToBuilderBlocks,
  type BuilderContentEntry,
} from "./builder-mdx";
import { builderSourceComponentMappingFor } from "./builder-source-component-registry";
import { parseRegistryBlockData } from "./nfm-registry";

const entry: BuilderContentEntry = {
  id: "doc-entry-1",
  model: "docs-content",
  name: "Intro Doc",
  published: "published",
  lastUpdated: "1700000000000",
  data: {
    urlPath: "/c/docs/intro",
    pageTitle: "Intro Doc",
    blocks: [
      {
        "@type": "@builder.io/sdk:Element",
        "@version": 2,
        id: "text-1",
        component: {
          name: "Text",
          options: { text: "<h2>Hello</h2><p>Welcome to docs.</p>" },
        },
        responsiveStyles: {
          large: {
            marginTop: "20px",
            position: "relative",
          },
        },
      },
      {
        "@type": "@builder.io/sdk:Element",
        "@version": 2,
        id: "code-1",
        component: {
          name: "Code Block",
          options: {
            code: "console.log('hi')",
            language: "javascript",
            dark: true,
          },
        },
      },
      {
        "@type": "@builder.io/sdk:Element",
        "@version": 2,
        id: "symbol-1",
        component: {
          name: "Symbol",
          options: {
            symbol: {
              model: "docs-nav",
              entry: "nav-entry",
              data: { label: "Docs" },
              content: {
                id: "nav-entry",
                modelName: "symbol",
                name: "Docs Nav",
                data: {
                  title: "Docs Nav",
                  blocks: [
                    {
                      "@type": "@builder.io/sdk:Element",
                      "@version": 2,
                      id: "symbol-text-1",
                      component: {
                        name: "Text",
                        options: { text: "<p>Shared nav body</p>" },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ],
  },
};

const tabbedEntry: BuilderContentEntry = {
  id: "doc-entry-tabs",
  model: "docs-content",
  name: "Tabbed Doc",
  lastUpdated: "1700000000001",
  data: {
    urlPath: "/c/docs/tabs",
    pageTitle: "Tabbed Doc",
    blocks: [
      {
        "@type": "@builder.io/sdk:Element",
        "@version": 2,
        id: "tabs-1",
        component: {
          name: "Tabbed Content",
          options: {
            title: "Frameworks",
            tabs: [
              {
                id: "tab-react",
                label: "React",
                analyticsId: "react-tab",
                content: [
                  {
                    "@type": "@builder.io/sdk:Element",
                    "@version": 2,
                    id: "custom-nested",
                    component: {
                      name: "Docs Alert",
                      options: {
                        tone: "info",
                        body: "Keep this custom component raw.",
                      },
                    },
                    responsiveStyles: {
                      large: {
                        marginBottom: "16px",
                        position: "relative",
                      },
                    },
                  },
                  {
                    "@type": "@builder.io/sdk:Element",
                    "@version": 2,
                    id: "nested-code",
                    component: {
                      name: "Code Block",
                      options: {
                        code: "npm install @builder.io/sdk-react",
                        language: "bash",
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  },
};

function testBlocks(entry: BuilderContentEntry): unknown[] {
  return Array.isArray(entry.data?.blocks) ? entry.data.blocks : [];
}

describe("Builder MDX conversion", () => {
  it("classifies Builder source components through an explicit mapping registry", () => {
    expect(builderSourceComponentMappingFor("Text")).toMatchObject({
      id: "builder-text-markdown",
      readableMode: "editable-markdown",
      mappingStatus: "mapped",
      sourceEditState: "safe-to-edit",
    });
    expect(builderSourceComponentMappingFor("Material Table")).toMatchObject({
      id: "builder-table-preserved",
      readableMode: "source-component",
      mappingStatus: "preserved",
      sourceEditState: "needs-review",
    });
    expect(builderSourceComponentMappingFor(" material_table ")).toMatchObject({
      id: "builder-table-preserved",
    });
    expect(builderSourceComponentMappingFor("PricingTable")).toMatchObject({
      id: "builder-table-preserved",
    });
    expect(builderSourceComponentMappingFor("Portable Text")).toMatchObject({
      id: "builder-unknown-preserved",
    });
    expect(builderSourceComponentMappingFor("Timetable Widget")).toMatchObject({
      id: "builder-unknown-preserved",
    });
    expect(builderSourceComponentMappingFor("Preferences Panel")).toMatchObject(
      {
        id: "builder-unknown-preserved",
      },
    );
    expect(
      builderSourceComponentMappingFor("Internal Reference"),
    ).toMatchObject({
      id: "builder-reference-preserved",
      readableMode: "source-component",
      mappingStatus: "preserved",
      sourceEditState: "needs-review",
    });
    expect(
      builderSourceComponentMappingFor("CustomerOnlyWidget"),
    ).toMatchObject({
      id: "builder-unknown-preserved",
      readableMode: "source-component",
      mappingStatus: "unknown",
      sourceEditState: "preserved-only",
    });
    expect(builderSourceComponentMappingFor(null)).toMatchObject({
      id: "builder-nameless-preserved",
      mappingStatus: "unknown",
      sourceEditState: "preserved-only",
    });
  });

  it("parses legacy and malformed source-component mapping attrs safely", async () => {
    const legacy = await parseRegistryBlockData(
      '<SourceComponent id="legacy-source-component" provider="builder" componentName="LegacyWidget" rawRef="content/builder/.raw/legacy.json" rawHash="legacy-hash" />',
    );
    expect(legacy?.data).toMatchObject({
      provider: "builder",
      componentName: "LegacyWidget",
      rawRef: "content/builder/.raw/legacy.json",
      rawHash: "legacy-hash",
    });
    expect(
      (legacy?.data as { mappingStatus?: unknown }).mappingStatus,
    ).toBeUndefined();
    expect(
      (legacy?.data as { sourceEditState?: unknown }).sourceEditState,
    ).toBeUndefined();

    const malformed = await parseRegistryBlockData(
      '<SourceComponent id="bad-source-component" provider="builder" componentName="BadWidget" rawRef="content/builder/.raw/bad.json" rawHash="bad-hash" mappingStatus="delete-me" sourceEditState="editable-maybe" previewStatus="fine" previewKind="thing" />',
    );
    expect(malformed?.data).toMatchObject({
      provider: "builder",
      componentName: "BadWidget",
      rawRef: "content/builder/.raw/bad.json",
      rawHash: "bad-hash",
    });
    expect(
      (malformed?.data as { mappingStatus?: unknown }).mappingStatus,
    ).toBeUndefined();
    expect(
      (malformed?.data as { sourceEditState?: unknown }).sourceEditState,
    ).toBeUndefined();
    expect(
      (malformed?.data as { previewStatus?: unknown }).previewStatus,
    ).toBeUndefined();
    expect(
      (malformed?.data as { previewKind?: unknown }).previewKind,
    ).toBeUndefined();
  });

  it("pulls Builder blocks into .builder.mdx with raw sidecars", async () => {
    const bundle = await builderEntryToMdxBundle(entry);

    expect(bundle.mdx.path).toBe(
      "content/builder/docs/c-docs-intro.builder.mdx",
    );
    expect(bundle.mdx.source).toContain("<BuilderText");
    expect(bundle.mdx.source).toContain("<BuilderCodeBlock");
    expect(bundle.mdx.source).toContain("<BuilderSymbol");
    expect(bundle.mdx.source).toContain(
      'source="content/builder/symbols/symbol/docs-nav.builder.mdx"',
    );
    expect(
      bundle.files["content/builder/symbols/symbol/docs-nav.builder.mdx"],
    ).toContain("Shared nav body");
    expect(
      Object.keys(bundle.files).filter((path) => path.endsWith(".json")),
    ).toHaveLength(4);
  });

  it("round-trips unchanged Builder blocks without loss", async () => {
    const bundle = await builderEntryToMdxBundle(entry);

    const result = await builderMdxToBuilderBlocks({
      path: bundle.mdx.path,
      source: bundle.mdx.source,
      sidecars: bundle.files,
    });

    expect(result.blocks).toEqual(testBlocks(entry));
    expect(result.blocksHash).toBe(builderBlocksHash(testBlocks(entry)));
  });

  it("round-trips edited modeled blocks through their sidecars", async () => {
    const bundle = await builderEntryToMdxBundle(entry);
    const editedSource = bundle.mdx.source.replace("Hello", "Hello again");

    const result = await builderMdxToBuilderBlocks({
      path: bundle.mdx.path,
      source: editedSource,
      sidecars: bundle.files,
    });

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0]).toMatchObject({
      id: "text-1",
      component: {
        name: "Text",
        options: {
          text: expect.stringContaining("Hello again"),
        },
      },
      responsiveStyles: {
        large: {
          marginTop: "20px",
        },
      },
    });
  });

  it("converts fresh markdown images into Builder image blocks", async () => {
    const source = [
      "---",
      'id: "builder_blog-article_local-image"',
      "title: Local image",
      'builder: {"model":"blog-article","entryId":"local-image","sourceHash":"source-hash","blocksHash":"blocks-hash","rawRoot":"content/builder/.raw/blog-article/local-image","path":"content/builder/blog/local-image.builder.mdx"}',
      "---",
      "",
      "Intro paragraph.",
      "",
      "![Product diagram](https://cdn.example.com/product.png)",
    ].join("\n");

    const result = await builderMdxToBuilderBlocks({
      path: "content/builder/blog-article/local-image.builder.mdx",
      source,
      sidecars: {},
    });

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]).toMatchObject({
      component: {
        name: "Image",
        options: {
          image: "https://cdn.example.com/product.png",
          altText: "Product diagram",
        },
      },
    });
  });

  it("reverses emitted markdown image URL escaping when round-tripping Builder images", async () => {
    const article: BuilderContentEntry = {
      id: "article-image-url-escape",
      model: "blog-article",
      name: "Article Image URL Escape",
      data: {
        title: "Article Image URL Escape",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "image-paren",
            component: {
              name: "Image",
              options: {
                image: "https://cdn.example.com/screenshots/plan(1).png",
                altText: "Plan screenshot",
              },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    expect(readable.mdx.body).toContain(
      "![Plan screenshot](https://cdn.example.com/screenshots/plan(1%29.png)",
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body,
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    expect(result.blocks?.[0]).toMatchObject({
      component: {
        name: "Image",
        options: {
          image: "https://cdn.example.com/screenshots/plan(1).png",
          altText: "Plan screenshot",
        },
      },
    });
  });

  it("blocks pushability when a raw sidecar hash is tampered", async () => {
    const bundle = await builderEntryToMdxBundle(entry);
    const rawPath = Object.keys(bundle.files).find((path) =>
      path.endsWith(".json"),
    );
    expect(rawPath).toBeTruthy();
    const tampered = {
      ...bundle.files,
      [rawPath!]: bundle.files[rawPath!].replace("text-1", "text-tampered"),
    };

    await expect(
      builderMdxToBuilderBlocks({
        path: bundle.mdx.path,
        source: bundle.mdx.source,
        sidecars: tampered,
      }),
    ).rejects.toThrow("hash mismatch");
  });

  it("blocks pushability when a referenced raw sidecar is missing", async () => {
    const bundle = await builderEntryToMdxBundle(entry);

    await expect(
      builderMdxToBuilderBlocks({
        path: bundle.mdx.path,
        source: bundle.mdx.source,
        sidecars: {},
      }),
    ).rejects.toThrow("Missing Builder raw sidecar");
  });

  it("rejects unsupported MDX instead of pushing it as Builder text", async () => {
    const bundle = await builderEntryToMdxBundle(entry);

    await expect(
      builderMdxToBuilderBlocks({
        path: bundle.mdx.path,
        source: `${bundle.mdx.source}\n\nexport const meta = {}\n`,
        sidecars: bundle.files,
      }),
    ).rejects.toThrow("Unsupported Builder MDX syntax");

    await expect(
      builderMdxToBuilderBlocks({
        path: bundle.mdx.path,
        source: `${bundle.mdx.source}\n\n<CustomDocsWidget />\n`,
        sidecars: bundle.files,
      }),
    ).rejects.toThrow("Unsupported Builder MDX component");
  });

  it("rejects Symbol entry retargeting", async () => {
    const bundle = await builderEntryToMdxBundle(entry);
    const retargetedSource = bundle.mdx.source.replace(
      'entry="nav-entry"',
      'entry="other-entry"',
    );

    await expect(
      builderMdxToBuilderBlocks({
        path: bundle.mdx.path,
        source: retargetedSource,
        sidecars: bundle.files,
      }),
    ).rejects.toThrow("Symbol entry is read-only");
  });

  it("round-trips Tabbed Content with nested raw blocks and tab metadata", async () => {
    const bundle = await builderEntryToMdxBundle(tabbedEntry);

    expect(bundle.mdx.source).toContain("<BuilderTabbedContent");
    expect(bundle.mdx.source).toContain("<BuilderRawBlock");

    const result = await builderMdxToBuilderBlocks({
      path: bundle.mdx.path,
      source: bundle.mdx.source,
      sidecars: bundle.files,
    });

    expect(result.blocks).toEqual(testBlocks(tabbedEntry));
    expect(result.blocksHash).toBe(builderBlocksHash(testBlocks(tabbedEntry)));
  });

  it("merges readable edits inside Builder tab content", async () => {
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(tabbedEntry),
      builderEntryToMdxBundle(tabbedEntry),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    expect(readable.mdx.body).toContain("### React");
    expect(readable.mdx.body).toContain("npm install @builder.io/sdk-react");

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body
        .replace("### React", "### React SDK")
        .replace(
          "npm install @builder.io/sdk-react",
          "pnpm add @builder.io/sdk-react",
        ),
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    const tabsBlock = result.blocks?.[0] as any;
    expect(tabsBlock.component.options.tabs[0]).toMatchObject({
      label: "React SDK",
      analyticsId: "react-tab",
    });
    expect(tabsBlock.component.options.tabs[0].content[1]).toMatchObject({
      id: "nested-code",
      component: {
        name: "Code Block",
        options: {
          code: "pnpm add @builder.io/sdk-react",
          language: "bash",
        },
      },
    });
  });

  it("emits readable child text for unknown Builder container blocks", async () => {
    const bundle = await builderEntryToMdxBundle({
      id: "article-with-container",
      model: "blog-article",
      name: "Container Article",
      data: {
        title: "Container Article",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "section-1",
            component: {
              name: "Core:Section",
              options: { maxWidth: 1200 },
            },
            children: [
              {
                "@type": "@builder.io/sdk:Element",
                "@version": 2,
                id: "section-text-1",
                component: {
                  name: "Text",
                  options: {
                    text: "<h2>Readable heading</h2><p>This paragraph should appear in Content.</p>",
                  },
                },
              },
            ],
          },
        ],
      },
    });

    expect(bundle.mdx.body).toContain("Readable heading");
    expect(bundle.mdx.body).toContain(
      "This paragraph should appear in Content.",
    );
    expect(bundle.mdx.body).not.toContain("<BuilderRawBlock");
  });

  it("preserves known Builder reference blocks instead of flattening nested children", async () => {
    const article: BuilderContentEntry = {
      id: "article-reference-block",
      model: "blog-article",
      name: "Article Reference Block",
      data: {
        title: "Article Reference Block",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "reference-1",
            component: {
              name: "Reference Block",
              options: {
                entry: "shared-doc",
                model: "docs-content",
              },
            },
            children: [
              {
                "@type": "@builder.io/sdk:Element",
                "@version": 2,
                id: "reference-child-text",
                component: {
                  name: "Text",
                  options: {
                    text: "<p>This child text belongs to the source reference.</p>",
                  },
                },
              },
            ],
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);

    expect(readable.mdx.body).toContain("<SourceComponent");
    expect(readable.mdx.body).toContain('componentName="Reference Block"');
    expect(readable.mdx.body).not.toContain(
      "This child text belongs to the source reference.",
    );
    const marker = readable.mdx.body
      .split("\n\n")
      .find((unit) => unit.includes("<SourceComponent"));
    expect(marker).toBeDefined();
    const parsedMarker = await parseRegistryBlockData(marker!);
    expect(parsedMarker?.data).toMatchObject({
      provider: "builder",
      componentName: "Reference Block",
      mappingId: "builder-reference-preserved",
      mappingStatus: "preserved",
      sourceEditState: "needs-review",
    });
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body,
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    expect(result.blocks).toEqual(lossless.blocks);
  });

  it("hydrates database bodies as clean readable markdown", async () => {
    const bundle = await builderEntryToReadableMdxBundle(entry);

    expect(bundle.mdx.body).toContain("## Hello");
    expect(bundle.mdx.body).toContain("Welcome to docs.");
    expect(bundle.mdx.body).toContain("<SourceComponent");
    expect(bundle.mdx.body).toContain('componentName="Symbol"');
    const marker = bundle.mdx.body
      .split("\n\n")
      .find((unit) => unit.includes('componentName="Symbol"'));
    expect(marker).toBeDefined();
    const parsedMarker = await parseRegistryBlockData(marker!);
    expect(parsedMarker?.data).toMatchObject({
      componentName: "Symbol",
      mappingId: "builder-symbol-preserved",
      mappingStatus: "preserved",
      sourceEditState: "needs-review",
      previewKind: "symbol",
    });
    expect(bundle.mdx.body).not.toContain("<BuilderText");
    expect(bundle.mdx.body).not.toContain("<BuilderRawBlock");
  });

  it("hydrates Builder images as native markdown images", async () => {
    const article: BuilderContentEntry = {
      id: "article-with-image",
      model: "blog-article",
      name: "Article with Image",
      data: {
        title: "Article with Image",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "image-1",
            component: {
              name: "Image",
              options: {
                image:
                  "https://cdn.builder.io/api/v1/image/assets%2Fdemo%2Fimage.png?width=780",
                altText: "Architecture diagram",
              },
            },
          },
        ],
      },
    };
    const readable = await builderEntryToReadableMdxBundle(article);

    expect(readable.mdx.body).toBe(
      "![Architecture diagram](https://cdn.builder.io/api/v1/image/assets%2Fdemo%2Fimage.png?width=780)",
    );
    expect(readable.mdx.body).not.toContain("<SourceComponent");
  });

  it("merges native markdown image edits back into Builder image blocks", async () => {
    const article: BuilderContentEntry = {
      id: "article-with-editable-image",
      model: "blog-article",
      name: "Article with Editable Image",
      data: {
        title: "Article with Editable Image",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-before",
            component: {
              name: "Text",
              options: { text: "<p>Intro paragraph.</p>" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "image-1",
            component: {
              name: "Image",
              options: {
                image: "https://cdn.example.com/before.png",
                altText: "Before diagram",
              },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    expect(readable.mdx.body).toContain(
      "![Before diagram](https://cdn.example.com/before.png)",
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body.replace(
        "![Before diagram](https://cdn.example.com/before.png)",
        "![After diagram](https://cdn.example.com/after.png)",
      ),
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    expect(result.blocks?.[1]).toMatchObject({
      id: "image-1",
      component: {
        name: "Image",
        options: {
          image: "https://cdn.example.com/after.png",
          altText: "After diagram",
        },
      },
    });
  });

  it("merges readable markdown edits back into Builder text while preserving unsupported blocks", async () => {
    const article: BuilderContentEntry = {
      id: "article-with-embed",
      model: "blog-article",
      name: "Article with Embed",
      data: {
        title: "Article with Embed",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-before",
            component: {
              name: "Text",
              options: { text: "<p>First paragraph.</p>" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "embed-1",
            component: {
              name: "Embed",
              options: { url: "https://example.com/embed" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-after",
            component: {
              name: "Text",
              options: { text: "<p>Second paragraph.</p>" },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    expect(readable.mdx.body).toContain("<SourceComponent");
    expect(readable.mdx.body).toContain('componentName="Embed"');
    const marker = readable.mdx.body
      .split("\n\n")
      .find((unit) => unit.includes("<SourceComponent"));
    expect(marker).toBeDefined();
    const parsedMarker = await parseRegistryBlockData(marker!);
    expect(parsedMarker?.type).toBe("source-component");
    expect(parsedMarker?.data).toMatchObject({
      provider: "builder",
      componentName: "Embed",
      mappingId: "builder-embed-preserved",
      mappingStatus: "preserved",
      sourceEditState: "needs-review",
      previewStatus: "available",
      previewKind: "embed",
      previewUrl: "https://example.com/embed",
    });
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body.replace(
        "First paragraph.",
        "First paragraph edited.",
      ),
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks?.[0]).toMatchObject({
      id: "text-before",
      component: {
        name: "Text",
        options: { text: expect.stringContaining("First paragraph edited.") },
      },
    });
    expect(result.blocks?.[1]).toMatchObject({
      id: "embed-1",
      component: { name: "Embed" },
    });
    expect(result.blocks?.[2]).toMatchObject({
      id: "text-after",
      component: {
        name: "Text",
        options: { text: expect.stringContaining("Second paragraph.") },
      },
    });
  });

  it("blocks readable merge when a source component marker is removed", async () => {
    const article: BuilderContentEntry = {
      id: "article-marker-delete",
      model: "blog-article",
      name: "Article Marker Delete",
      data: {
        title: "Article Marker Delete",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-before",
            component: {
              name: "Text",
              options: { text: "<p>First paragraph.</p>" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "table-1",
            component: {
              name: "Table",
              options: { rows: [["A", "B"]] },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );
    const tableMarker = readable.mdx.body
      .split("\n\n")
      .find((unit) => unit.includes("<SourceComponent"));
    expect(tableMarker).toBeDefined();
    const parsedTableMarker = await parseRegistryBlockData(tableMarker!);
    expect(parsedTableMarker?.data).toMatchObject({
      provider: "builder",
      componentName: "Table",
      previewKind: "table",
      previewItems: ["1 row", "2 columns"],
      preview: {
        status: "available",
        kind: "table",
        label: "Builder Table",
        fields: [
          { label: "row", value: "1" },
          { label: "columns", value: "2" },
        ],
        table: {
          columns: [
            { id: "column-1", label: "Column 1" },
            { id: "column-2", label: "Column 2" },
          ],
          rows: [{ "column-1": "A", "column-2": "B" }],
          truncated: false,
        },
      },
    });

    const withoutMarker = readable.mdx.body
      .split("\n\n")
      .filter((unit) => !unit.includes("<SourceComponent"))
      .join("\n\n");
    const result = await builderReadableBodyToBuilderBlocks({
      localContent: withoutMarker,
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.blocks).toBeNull();
    expect(result.warnings[0]).toContain(
      "changed preserved source component markers",
    );
  });

  it("keeps Builder blocks stable when readable markdown has no edits", async () => {
    const article: BuilderContentEntry = {
      id: "article-no-edit",
      model: "blog-article",
      name: "Article No Edit",
      data: {
        title: "Article No Edit",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-before",
            component: {
              name: "Text",
              options: { text: "<p>First paragraph.</p>" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "embed-1",
            component: {
              name: "Embed",
              options: { url: "https://example.com/embed" },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body,
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    expect(result.blocks).toEqual(lossless.blocks);
  });

  it("preserves source markers when adjacent readable prose changes", async () => {
    const article: BuilderContentEntry = {
      id: "article-adjacent-edit",
      model: "blog-article",
      name: "Article Adjacent Edit",
      data: {
        title: "Article Adjacent Edit",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-before",
            component: {
              name: "Text",
              options: { text: "<p>First paragraph.</p>" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "table-1",
            component: {
              name: "Table",
              options: { rows: [["A", "B"]] },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-after",
            component: {
              name: "Text",
              options: { text: "<p>Second paragraph.</p>" },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body
        .replace("First paragraph.", "First paragraph edited.")
        .replace("Second paragraph.", "Second paragraph edited."),
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    expect(result.blocks?.[1]).toMatchObject({
      id: "table-1",
      component: { name: "Table" },
    });
    expect(result.blocks?.[0]).toMatchObject({
      component: {
        name: "Text",
        options: { text: expect.stringContaining("First paragraph edited.") },
      },
    });
    expect(result.blocks?.[2]).toMatchObject({
      component: {
        name: "Text",
        options: { text: expect.stringContaining("Second paragraph edited.") },
      },
    });
  });

  it("blocks readable merge when a source component marker is moved", async () => {
    const article: BuilderContentEntry = {
      id: "article-marker-move",
      model: "blog-article",
      name: "Article Marker Move",
      data: {
        title: "Article Marker Move",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-before",
            component: {
              name: "Text",
              options: { text: "<p>First paragraph.</p>" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "embed-1",
            component: {
              name: "Embed",
              options: { url: "https://example.com/embed" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-after",
            component: {
              name: "Text",
              options: { text: "<p>Second paragraph.</p>" },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );
    const units = readable.mdx.body.split("\n\n");
    const marker = units.find((unit) => unit.includes("<SourceComponent"));
    const moved = units
      .filter((unit) => !unit.includes("<SourceComponent"))
      .concat(marker ? [marker] : [])
      .join("\n\n");

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: moved,
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.blocks).toBeNull();
    expect(result.warnings[0]).toContain("moved or restructured");
  });

  it("preserves completely unknown Builder component types as source markers", async () => {
    const article: BuilderContentEntry = {
      id: "article-unknown-component",
      model: "blog-article",
      name: "Article Unknown Component",
      data: {
        title: "Article Unknown Component",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "unknown-1",
            component: {
              name: "CustomerOnlyWidget",
              options: { message: "private provider shape" },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const marker = readable.mdx.body
      .split("\n\n")
      .find((unit) => unit.includes("<SourceComponent"));
    expect(marker).toBeDefined();
    const parsedMarker = await parseRegistryBlockData(marker!);
    expect(parsedMarker?.data).toMatchObject({
      provider: "builder",
      componentName: "CustomerOnlyWidget",
      mappingId: "builder-unknown-preserved",
      mappingStatus: "unknown",
      sourceEditState: "preserved-only",
      previewStatus: "warning",
      previewKind: "component",
      preview: {
        status: "warning",
        kind: "component",
        label: "Builder CustomerOnlyWidget",
      },
    });
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body,
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    expect(result.blocks).toEqual(lossless.blocks);
  });

  it("does not label mapped-name variants as safe-to-edit markers", async () => {
    const article: BuilderContentEntry = {
      id: "article-mapped-name-variant",
      model: "blog-article",
      name: "Article Mapped Name Variant",
      data: {
        title: "Article Mapped Name Variant",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "lowercase-text-1",
            component: {
              name: "text",
              options: { text: "<p>Lowercase mapped name.</p>" },
            },
          },
        ],
      },
    };

    const readable = await builderEntryToReadableMdxBundle(article);
    const marker = readable.mdx.body
      .split("\n\n")
      .find((unit) => unit.includes("<SourceComponent"));
    expect(marker).toBeDefined();
    const parsedMarker = await parseRegistryBlockData(marker!);
    expect(parsedMarker?.data).toMatchObject({
      provider: "builder",
      componentName: "text",
      mappingId: "builder-unknown-preserved",
      mappingStatus: "unknown",
      sourceEditState: "preserved-only",
      previewStatus: "warning",
      title: "Builder text",
    });
  });

  it("renders Builder Material Table components as structured source table previews", async () => {
    const article: BuilderContentEntry = {
      id: "article-material-table",
      model: "blog-article",
      name: "Article Material Table",
      data: {
        title: "Article Material Table",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "material-table-1",
            component: {
              name: "Material Table",
              options: {
                headColumns: [
                  { label: "Writing Code" },
                  { label: "Designing Systems" },
                ],
                bodyRows: [
                  {
                    columns: [
                      {
                        content: [
                          {
                            "@type": "@builder.io/sdk:Element",
                            "@version": 2,
                            id: "cell-1",
                            component: {
                              name: "Text",
                              options: { text: "<p>Hand-writing syntax</p>" },
                            },
                          },
                        ],
                      },
                      {
                        content: [
                          {
                            "@type": "@builder.io/sdk:Element",
                            "@version": 2,
                            id: "cell-2",
                            component: {
                              name: "Text",
                              options: {
                                text: "<p>Engineering deterministic constraints</p>",
                              },
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "pixel-1",
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const markers = readable.mdx.body
      .split("\n\n")
      .filter((unit) => unit.includes("<SourceComponent"));
    expect(markers).toHaveLength(2);
    const parsedTable = await parseRegistryBlockData(markers[0]!);
    expect(parsedTable?.data).toMatchObject({
      provider: "builder",
      componentName: "Material Table",
      mappingId: "builder-table-preserved",
      mappingStatus: "preserved",
      sourceEditState: "needs-review",
      previewKind: "table",
      previewItems: ["1 row", "2 columns"],
      preview: {
        status: "available",
        kind: "table",
        label: "Builder Table",
        table: {
          columns: [
            { id: "column-1", label: "Writing Code" },
            { id: "column-2", label: "Designing Systems" },
          ],
          rows: [
            {
              "column-1": "Hand-writing syntax",
              "column-2": "Engineering deterministic constraints",
            },
          ],
          truncated: false,
        },
      },
    });
    const parsedNameless = await parseRegistryBlockData(markers[1]!);
    expect(parsedNameless?.data).toMatchObject({
      componentName: "Builder component",
      mappingId: "builder-nameless-preserved",
      mappingStatus: "unknown",
      sourceEditState: "preserved-only",
      previewStatus: "unavailable",
    });
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: readable.mdx.body,
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.warnings).toEqual([]);
    expect(result.blocks).toEqual(lossless.blocks);
  });

  it("blocks readable merge when a source component marker is tampered", async () => {
    const article: BuilderContentEntry = {
      id: "article-marker-tamper",
      model: "blog-article",
      name: "Article Marker Tamper",
      data: {
        title: "Article Marker Tamper",
        blocks: [
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "text-before",
            component: {
              name: "Text",
              options: { text: "<p>First paragraph.</p>" },
            },
          },
          {
            "@type": "@builder.io/sdk:Element",
            "@version": 2,
            id: "embed-1",
            component: {
              name: "Embed",
              options: { url: "https://example.com/embed" },
            },
          },
        ],
      },
    };
    const [readable, lossless] = await Promise.all([
      builderEntryToReadableMdxBundle(article),
      builderEntryToMdxBundle(article),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(lossless.files).filter(
        ([path]) => path !== lossless.mdx.path,
      ),
    );
    const tampered = readable.mdx.body.replace(
      /rawHash="[^"]+"/,
      'rawHash="tampered"',
    );

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: tampered,
      losslessContent: lossless.mdx.body,
      sidecars,
    });

    expect(result.blocks).toBeNull();
    expect(result.warnings[0]).toContain("hash mismatch");
  });

  it("warns instead of merging readable markdown when the structure is ambiguous", async () => {
    const [readable, bundle] = await Promise.all([
      builderEntryToReadableMdxBundle(entry),
      builderEntryToMdxBundle(entry),
    ]);
    const sidecars = Object.fromEntries(
      Object.entries(bundle.files).filter(([path]) => path !== bundle.mdx.path),
    );
    const marker = readable.mdx.body
      .split("\n\n")
      .find((unit) => unit.includes("<SourceComponent"));

    const result = await builderReadableBodyToBuilderBlocks({
      localContent: [
        "One new paragraph that no longer matches the source shape.",
        marker,
      ]
        .filter(Boolean)
        .join("\n\n"),
      losslessContent: bundle.mdx.body,
      sidecars,
    });

    expect(result.blocks).toBeNull();
    expect(result.warnings[0]).toContain("changed structure");
  });
});
