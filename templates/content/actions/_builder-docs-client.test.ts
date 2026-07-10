import { resolveBuilderCredential } from "@agent-native/core/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api.js";
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

const requestContextMock = vi.hoisted(() => ({
  orgId: null as string | null,
  userEmail: "owner@example.com",
}));

const resolveBuilderCredentialMock = vi.hoisted(() =>
  vi.fn(async (_key: string) => null as string | null),
);

const collabStateMock = vi.hoisted(() => ({
  hasCollabState: vi.fn(async () => false),
  loadAwarenessRowsStrict: vi.fn(
    async () =>
      [] as Array<{ clientId: number; state: string; lastSeen: number }>,
  ),
}));

const appStateMock = vi.hoisted(() => ({
  appStateDelete: vi.fn(async () => {}),
  appStateGet: vi.fn(async () => null as unknown),
  appStatePut: vi.fn(async () => {}),
  writeAppState: vi.fn(async () => {}),
}));

const builderWriteMock = vi.hoisted(() => ({
  executeBuilderCmsWrite: vi.fn(async () => ({
    ok: true,
    status: 200,
    entryId: "builder-entry-db",
    responseBody: { id: "builder-entry-db" },
  })),
}));

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
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        documentResource = { ...(documentResource ?? {}), ...values };
      },
    }),
  }),
  delete: () => ({
    where: async () => {
      sidecarRows = [];
    },
  }),
  insert: () => ({
    values: async (
      values: Record<string, unknown> | Array<Record<string, unknown>>,
    ) => {
      const rows = Array.isArray(values) ? values : [values];
      if (
        rows.every(
          (row) => typeof row.path === "string" && "contentHash" in row,
        )
      ) {
        sidecarRows = rows.map((row) => ({
          path: String(row.path),
          content: typeof row.content === "string" ? row.content : "",
          contentHash:
            typeof row.contentHash === "string" ? row.contentHash : "",
        }));
      } else {
        documentResource = { ...rows[0] };
      }
    },
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
  resolveBuilderCredential: resolveBuilderCredentialMock,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(() => requestContextMock.orgId),
  getRequestUserEmail: vi.fn(() => requestContextMock.userEmail),
}));

vi.mock("@agent-native/core/collab", () => ({
  AGENT_CLIENT_ID: 0xffffffff,
  hasCollabState: collabStateMock.hasCollabState,
  loadAwarenessRowsStrict: collabStateMock.loadAwarenessRowsStrict,
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateDelete: appStateMock.appStateDelete,
  appStateGet: appStateMock.appStateGet,
  appStatePut: appStateMock.appStatePut,
  writeAppState: appStateMock.writeAppState,
}));

vi.mock("./_builder-cms-write-client.js", () => ({
  executeBuilderCmsWrite: builderWriteMock.executeBuilderCmsWrite,
}));

let resolveBuilderDocsSource: typeof import("./_builder-docs-client.js").resolveBuilderDocsSource;
let pullBuilderDocIntoContent: typeof import("./_builder-docs-client.js").pullBuilderDocIntoContent;
let readFullBuilderDocsEntry: typeof import("./_builder-docs-client.js").readFullBuilderDocsEntry;
let checkBuilderDocsSource: typeof import("./_builder-docs-client.js").checkBuilderDocsSource;
let listBuilderDocsEntries: typeof import("./_builder-docs-client.js").listBuilderDocsEntries;
let pushBuilderDocsSource: typeof import("./_builder-docs-client.js").pushBuilderDocsSource;

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
  const client = await import("./_builder-docs-client.js");
  resolveBuilderDocsSource = client.resolveBuilderDocsSource;
  pullBuilderDocIntoContent = client.pullBuilderDocIntoContent;
  readFullBuilderDocsEntry = client.readFullBuilderDocsEntry;
  checkBuilderDocsSource = client.checkBuilderDocsSource;
  listBuilderDocsEntries = client.listBuilderDocsEntries;
  pushBuilderDocsSource = client.pushBuilderDocsSource;
});

beforeEach(() => {
  documentResource = null;
  sidecarRows = [];
  requestContextMock.orgId = null;
  requestContextMock.userEmail = "owner@example.com";
  vi.clearAllMocks();
  resolveBuilderCredentialMock.mockResolvedValue(null);
  collabStateMock.hasCollabState.mockResolvedValue(false);
  collabStateMock.loadAwarenessRowsStrict.mockResolvedValue([]);
  appStateMock.appStateGet.mockResolvedValue(null);
  builderWriteMock.executeBuilderCmsWrite.mockResolvedValue({
    ok: true,
    status: 200,
    entryId: "builder-entry-db",
    responseBody: { id: "builder-entry-db" },
  });
});

function mcpResponse(
  body: Record<string, unknown>,
  sessionId?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: sessionId ? { "mcp-session-id": sessionId } : undefined,
  });
}

function mcpFetchForEntry(entry: BuilderContentEntry) {
  return mcpFetchForEntries([entry]);
}

function mcpFetchForEntries(entries: BuilderContentEntry[]) {
  let readIndex = 0;
  return vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    if (body.method === "initialize") {
      return mcpResponse({ jsonrpc: "2.0", id: body.id, result: {} }, "s-1");
    }
    if (body.method === "notifications/initialized") {
      return mcpResponse({ jsonrpc: "2.0", result: {} });
    }
    const entry = entries[Math.min(readIndex, entries.length - 1)];
    readIndex += 1;
    return mcpResponse({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({ content: [entry] }),
          },
        ],
      },
    });
  });
}

describe("Builder docs list and conflict safety", () => {
  it("lists published entries through the public Content API only", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key: string) =>
      key === "BUILDER_PUBLIC_KEY"
        ? "public-key"
        : key === "BUILDER_PRIVATE_KEY"
          ? "private-key"
          : null,
    );
    const fetchImpl = vi.fn(async (input: URL, init?: RequestInit) => {
      expect(input.href).toContain("/api/v3/content/docs-content");
      expect(input.searchParams.get("apiKey")).toBe("public-key");
      expect(input.searchParams.get("includeUnpublished")).toBeNull();
      expect(input.searchParams.get("limit")).toBe("25");
      expect(init?.headers).toMatchObject({
        accept: "application/json",
      });
      expect(init?.headers).not.toHaveProperty("authorization");
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "published-doc",
              name: "Published Doc",
              lastUpdated: "2026-06-28T12:00:00.000Z",
              data: {
                title: "Published Doc",
                urlPath: "/c/docs/published-doc",
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await listBuilderDocsEntries({
      model: "docs-content",
      limit: 25,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      state: "live",
      entries: [
        {
          id: "published-doc",
          model: "docs-content",
          title: "Published Doc",
          urlPath: "/c/docs/published-doc",
        },
      ],
    });
    expect(resolveBuilderCredential).toHaveBeenCalledWith("BUILDER_PUBLIC_KEY");
    expect(resolveBuilderCredential).not.toHaveBeenCalledWith(
      "BUILDER_PRIVATE_KEY",
    );
    expect(resolveBuilderCredential).not.toHaveBeenCalledWith(
      "BUILDER_CMS_PRIVATE_KEY",
    );
  });

  it("blocks push/check when remote Builder blocks changed since pull", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key: string) =>
      key === "BUILDER_PRIVATE_KEY" ? "private-key" : null,
    );
    const bundle = await builderEntryToMdxBundle(entry);
    const remoteEntry = JSON.parse(
      JSON.stringify(entry),
    ) as BuilderContentEntry;
    const [firstBlock] = (remoteEntry.data?.blocks ?? []) as Array<
      Record<string, unknown>
    >;
    firstBlock.component = {
      name: "Text",
      options: { text: "<p>Remote changed text.</p>" },
    };

    const result = await checkBuilderDocsSource({
      files: bundle.files,
      fetchImpl: mcpFetchForEntry(remoteEntry) as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      "Remote Builder blocks changed since pull.",
    );
    expect(result.remoteBlocksHash).not.toBe(bundle.mdx.metadata.blocksHash);
  });
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

  it("flushes a live editor before reconstructing DB-backed MDX", async () => {
    const bundle = await builderEntryToMdxBundle(entry);
    documentResource = {
      id: bundle.mdx.documentId,
      ownerEmail: "owner@example.com",
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
    collabStateMock.hasCollabState.mockResolvedValue(true);
    collabStateMock.loadAwarenessRowsStrict.mockResolvedValue([
      {
        clientId: 123,
        state: JSON.stringify({
          visible: true,
          user: { email: "owner@example.com" },
        }),
        lastSeen: Date.now(),
      },
    ]);
    appStateMock.appStateGet.mockImplementation(async () => ({
      id: bundle.mdx.documentId,
      requestId: appStateMock.appStatePut.mock.calls[0]?.[2]?.requestId,
      status: "success",
    }));

    await resolveBuilderDocsSource({ documentId: bundle.mdx.documentId });

    expect(appStateMock.appStatePut).toHaveBeenCalledWith(
      "owner@example.com",
      `flush-request-${bundle.mdx.documentId}`,
      expect.objectContaining({ id: bundle.mdx.documentId }),
      { requestSource: "agent" },
    );
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

  it("refreshes DB metadata and sidecars after a successful document push", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key: string) =>
      key === "BUILDER_PRIVATE_KEY" ? "private-key" : null,
    );
    const safeEntry = {
      ...entry,
      model: BUILDER_CMS_SAFE_WRITE_MODEL,
      data: {
        ...entry.data,
        handle: "db-builder-doc",
      },
    };
    const bundle = await builderEntryToMdxBundle(safeEntry);
    const sidecars = Object.fromEntries(
      Object.entries(bundle.files).filter(
        ([path]) => path.includes("/.raw/") && path.endsWith(".json"),
      ),
    );
    documentResource = {
      id: bundle.mdx.documentId,
      ownerEmail: "owner@example.com",
      orgId: null,
      title: bundle.mdx.title,
      content: bundle.mdx.body.replace("DB backed text.", "Local pushed text."),
      sourceMode: BUILDER_DOCS_MDX_SOURCE_MODE,
      sourceKind: builderSourceKindForModel(safeEntry.model),
      sourcePath: bundle.mdx.path,
      sourceRootPath: builderSourceRootPath({
        entryId: safeEntry.id,
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

    const pushedEntry = JSON.parse(
      JSON.stringify(safeEntry),
    ) as BuilderContentEntry;
    pushedEntry.lastUpdated = "1700000000003";
    const [firstBlock] = pushedEntry.data.blocks as Array<
      Record<string, unknown>
    >;
    firstBlock.component = {
      name: "Text",
      options: { text: "<p>Local pushed text.</p>" },
    };

    const result = await pushBuilderDocsSource({
      documentId: bundle.mdx.documentId,
      dryRun: false,
      fetchImpl: mcpFetchForEntries([safeEntry, pushedEntry]) as typeof fetch,
    });

    expect(result.executed).toBe(true);
    expect(builderWriteMock.executeBuilderCmsWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          method: "PATCH",
          body: {
            data: {
              blocksString: expect.stringContaining("Local pushed text."),
            },
          },
        }),
      }),
    );
    expect(documentResource).toMatchObject({
      content: expect.stringContaining("Local pushed text."),
      sourceUpdatedAt: "1700000000003",
      sourceRootPath: builderSourceRootPath({
        entryId: safeEntry.id,
        sourceHash: result.refreshedDocument?.metadata.sourceHash ?? "",
        blocksHash: result.refreshedDocument?.metadata.blocksHash ?? "",
      }),
    });
    expect(result.refreshedDocument?.metadata.lastUpdated).toBe(
      "1700000000003",
    );
    expect(sidecarRows.length).toBeGreaterThan(0);
    expect(appStateMock.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it("requires a private Builder credential for full docs reads", async () => {
    await expect(
      readFullBuilderDocsEntry({
        model: "docs-content",
        entryId: "builder-entry-db",
      }),
    ).rejects.toThrow("requires a Builder private credential");
    expect(resolveBuilderCredential).toHaveBeenCalledWith(
      "BUILDER_PRIVATE_KEY",
    );
  });

  it("scopes pulled document ids to the caller owner and org", async () => {
    resolveBuilderCredentialMock.mockImplementation(async (key: string) =>
      key === "BUILDER_PRIVATE_KEY" ? "private-key" : null,
    );
    const first = await pullBuilderDocIntoContent({
      model: "docs-content",
      entryId: "builder-entry-db",
      dryRun: true,
      fetchImpl: mcpFetchForEntry(entry) as typeof fetch,
    });

    requestContextMock.userEmail = "other@example.com";
    requestContextMock.orgId = "org-2";
    const second = await pullBuilderDocIntoContent({
      model: "docs-content",
      entryId: "builder-entry-db",
      dryRun: true,
      fetchImpl: mcpFetchForEntry(entry) as typeof fetch,
    });

    expect(first.documentId).not.toBe(second.documentId);
    expect(first.bundle.mdx.documentId).toBe(first.documentId);
    expect(second.bundle.mdx.documentId).toBe(second.documentId);
  });
});
