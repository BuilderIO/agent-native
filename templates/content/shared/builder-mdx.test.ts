import { describe, expect, it } from "vitest";

import {
  builderBlocksHash,
  builderEntryToMdxBundle,
  builderMdxToBuilderBlocks,
  type BuilderContentEntry,
} from "./builder-mdx";

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
});
