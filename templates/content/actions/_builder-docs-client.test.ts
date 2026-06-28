import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUILDER_DOCS_MDX_SOURCE_MODE,
  builderSourceKindForModel,
  builderSourceRootPath,
} from "../shared/builder-docs-blocks.js";
import {
  builderEntryToMdxBundle,
  builderMdxToBuilderBlocks,
  stableHash,
  type BuilderContentEntry,
} from "../shared/builder-mdx.js";

let documentResource: Record<string, unknown> | null = null;
let sidecarRows: Array<{
  path: string;
  content: string;
  contentHash: string;
}> = [];

const fakeDb = {
  select: () => ({
    from: () => ({
      where: async () => sidecarRows,
    }),
  }),
};

vi.mock("../server/db/index.js", async () => {
  const schema = await vi.importActual<typeof import("../server/db/schema.js")>(
    "../server/db/schema.js",
  );
  return {
    getDb: () => fakeDb,
    schema,
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  ROLE_RANK: {
    viewer: 0,
    editor: 1,
    admin: 2,
    owner: 3,
  },
  resolveAccess: vi.fn(async () =>
    documentResource ? { role: "owner", resource: documentResource } : null,
  ),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveBuilderCredential: vi.fn(async () => null),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(() => null),
  getRequestUserEmail: vi.fn(() => "owner@example.com"),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

let resolveBuilderDocsSource: typeof import("./_builder-docs-client.js").resolveBuilderDocsSource;

const entry: BuilderContentEntry = {
  id: "builder-entry-db",
  model: "docs-content",
  name: "DB Builder Doc",
  lastUpdated: "1700000000002",
  data: {
    urlPath: "/c/docs/db-builder-doc",
    pageTitle: "DB Builder Doc",
    blocks: [
      {
        "@type": "@builder.io/sdk:Element",
        "@version": 2,
        id: "text-db",
        component: {
          name: "Text",
          options: { text: "<p>DB backed text.</p>" },
        },
        responsiveStyles: {
          large: {
            marginTop: "12px",
            position: "relative",
          },
        },
      },
    ],
  },
};

beforeAll(async () => {
  resolveBuilderDocsSource = (await import("./_builder-docs-client.js"))
    .resolveBuilderDocsSource;
});

beforeEach(() => {
  documentResource = null;
  sidecarRows = [];
  vi.clearAllMocks();
});

describe("Builder docs DB-backed source", () => {
  it("reconstructs MDX metadata and raw sidecars from a pulled document", async () => {
    const bundle = await builderEntryToMdxBundle(entry);
    const sidecars = Object.fromEntries(
      Object.entries(bundle.files).filter(
        ([path]) => path.includes("/.raw/") && path.endsWith(".json"),
      ),
    );
    documentResource = {
      id: bundle.mdx.documentId,
      title: bundle.mdx.title,
      content: bundle.mdx.body,
      sourceMode: BUILDER_DOCS_MDX_SOURCE_MODE,
      sourceKind: builderSourceKindForModel(entry.model),
      sourcePath: bundle.mdx.path,
      sourceRootPath: builderSourceRootPath({
        entryId: entry.id,
        sourceHash: bundle.mdx.metadata.sourceHash,
        blocksHash: bundle.mdx.metadata.blocksHash,
      }),
      sourceUpdatedAt: bundle.mdx.metadata.lastUpdated,
    };
    sidecarRows = Object.entries(sidecars).map(([path, content]) => ({
      path,
      content,
      contentHash: stableHash(content),
    }));

    const resolved = await resolveBuilderDocsSource({
      documentId: bundle.mdx.documentId,
    });
    const local = await builderMdxToBuilderBlocks({
      path: resolved.mdx.path,
      source: resolved.mdx.source,
      sidecars: resolved.sidecars,
    });

    expect(resolved.mdx.metadata.sourceHash).toBe(
      bundle.mdx.metadata.sourceHash,
    );
    expect(resolved.mdx.metadata.blocksHash).toBe(
      bundle.mdx.metadata.blocksHash,
    );
    expect(resolved.sidecars).toEqual(sidecars);
    expect(local.blocks).toEqual(entry.data?.blocks);
  });

  it("fails legacy DB documents that have no durable blocksHash", async () => {
    const bundle = await builderEntryToMdxBundle(entry);
    documentResource = {
      id: bundle.mdx.documentId,
      title: bundle.mdx.title,
      content: bundle.mdx.body,
      sourceMode: BUILDER_DOCS_MDX_SOURCE_MODE,
      sourceKind: builderSourceKindForModel(entry.model),
      sourcePath: bundle.mdx.path,
      sourceRootPath: `${entry.id}#${bundle.mdx.metadata.sourceHash}`,
      sourceUpdatedAt: bundle.mdx.metadata.lastUpdated,
    };

    await expect(
      resolveBuilderDocsSource({ documentId: bundle.mdx.documentId }),
    ).rejects.toThrow("missing Builder blocksHash metadata");
  });
});
