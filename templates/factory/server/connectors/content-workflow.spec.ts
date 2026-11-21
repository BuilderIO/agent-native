import { McpAppApiError } from "@agent-native/core/mcp-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/factory-workflow-connections.js", () => ({
  readProviderConnections: vi.fn(async () => []),
}));

import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { operationOutputs } from "../workflow/operations.js";
import {
  parseCollectionRef,
  upsertContentRow,
  type ContentWorkflowDeps,
} from "./content-workflow.js";

const SERVER = "user_owner_content";
const SERVER_URL = "https://beta.content.agent-native.com/_agent-native/mcp";
const KEY = "prop-key";
const STATUS = "prop-status";
const CREATED = "prop-created";

interface Failure extends Error {
  errorCode: string;
  sideEffect: "none" | "maybe";
  retryable: boolean;
}

const tool = (serverId: string, name: string) => ({
  serverId,
  name,
  description: name,
  inputSchema: {},
});
const contentTools = (serverId = SERVER) => [
  tool(serverId, "get-content-database"),
  tool(serverId, "upsert-database-item-by-key"),
];

const answer = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
});
const refusal = (text: string) => ({
  content: [{ type: "text", text }],
  isError: true,
});

const contract = {
  target: {
    authorityScope: { kind: "organization", id: "org-1" },
    spaceId: "space-1",
    databaseId: "db-1",
    databaseDocumentId: "doc-db",
  },
  schemaRevision: "schema-7",
  naturalKeyPropertyId: KEY,
  properties: [
    { id: KEY, name: "Key", type: "text", writable: true },
    { id: STATUS, name: "Status", type: "select", writable: true },
    { id: CREATED, name: "Created", type: "created_time", writable: false },
  ],
};

const row = (key: string, rowRevision = "rev-3") => ({
  id: "item-1",
  rowRevision,
  document: { id: "doc-row" },
  properties: [{ propertyId: KEY, value: key }],
});

const receipt = (outcome: string) =>
  answer({
    receipt: {
      outcome,
      row: {
        itemId: "item-1",
        documentId: "doc-row",
        urlPath: "/page/doc-row?databaseId=db-1&databaseDocumentId=doc-db",
        rowRevision: "rev-4",
      },
    },
  });

function content(
  options: {
    tools?: ReturnType<typeof contentTools>;
    saved?: string[];
    rows?: unknown[];
    pages?: unknown[][];
    noPagination?: boolean;
    noItems?: boolean;
    columns?: unknown;
    write?: () => unknown;
  } = {},
) {
  const served =
    "columns" in options
      ? { ...contract, properties: options.columns }
      : contract;
  const callTool = vi.fn(
    async (_serverId: string, name: string, args: Record<string, unknown>) => {
      if (name === "get-content-database") {
        const filters =
          (args.tableQuery as { filters?: unknown[] } | undefined)?.filters ??
          [];
        if (filters.length === 0) {
          return answer({ mutationContract: served, items: [] });
        }
        const pages = options.pages ?? [options.rows ?? []];
        const page = Number(args.offset ?? 0) / 100;
        return answer({
          mutationContract: served,
          ...(options.noItems ? {} : { items: pages[page] ?? [] }),
          ...(options.noPagination
            ? {}
            : { pagination: { hasMore: page < pages.length - 1 } }),
        });
      }
      if (name === "upsert-database-item-by-key") {
        return options.write ? options.write() : receipt("created");
      }
      throw new Error(`unplanned ${name}`);
    },
  );
  const deps: ContentWorkflowDeps = {
    listTools: vi.fn(async () => options.tools ?? contentTools()),
    personalServers: vi.fn(async () =>
      (options.saved ?? [SERVER]).map((id) => ({ id, url: SERVER_URL })),
    ),
    callTool,
  };
  const writes = () =>
    callTool.mock.calls
      .filter(([, name]) => name === "upsert-database-item-by-key")
      .map(([, , args]) => args);
  return { deps, callTool, writes };
}

const identity = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
  automationId: "job-1",
  runId: "run-1",
  callId: "call-1",
};
const input = {
  collection: "https://beta.content.agent-native.com/page/doc-db",
  key: "TASK-1",
};

async function failure(run: Promise<unknown>): Promise<Failure> {
  try {
    await run;
  } catch (error) {
    return error as Failure;
  }
  throw new Error("expected the call to fail");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseCollectionRef", () => {
  it("reads a page ID, a page link and an open link", () => {
    expect(parseCollectionRef("doc-db")).toEqual({
      documentId: "doc-db",
      origin: null,
    });
    expect(
      parseCollectionRef("https://content.agent-native.com/page/doc-db?x=1"),
    ).toEqual({
      documentId: "doc-db",
      origin: "https://content.agent-native.com",
    });
    expect(
      parseCollectionRef(
        "https://beta.content.agent-native.com/_agent-native/open?app=content&view=editor&documentId=doc-db",
      ),
    ).toEqual({
      documentId: "doc-db",
      origin: "https://beta.content.agent-native.com",
    });
  });

  it("refuses text that names no page", () => {
    for (const text of ["not a link", "https://example.test/docs", "a/b"]) {
      expect(() => parseCollectionRef(text)).toThrow(
        expect.objectContaining({ errorCode: "content_collection_invalid" }),
      );
    }
  });
});

describe("upsertContentRow", () => {
  it("adds a row when no row has the key, asserting the key is absent", async () => {
    const { deps, writes } = content();

    const result = await upsertContentRow(
      { identity, deps },
      { ...input, title: " Fix login ", values: { status: "Done" } },
    );

    expect(result).toEqual({
      ok: true,
      outcome: "created",
      documentId: "doc-row",
      itemId: "item-1",
      url: "https://beta.content.agent-native.com/page/doc-row?databaseId=db-1&databaseDocumentId=doc-db",
    });
    expect(writes()).toEqual([
      {
        target: {
          spaceId: "space-1",
          databaseId: "db-1",
          databaseDocumentId: "doc-db",
        },
        expectedSchemaRevision: "schema-7",
        idempotencyKey: expect.stringMatching(/^factory-content-[0-9a-f]{40}$/),
        keyValue: "TASK-1",
        expectedRowRevision: null,
        title: "Fix login",
        propertyEntries: [
          { propertyId: STATUS, propertyType: "select", value: "Done" },
        ],
      },
    ]);
  });

  it("updates the row with the key at the revision it read", async () => {
    const { deps, callTool, writes } = content({
      rows: [row("TASK-1", "rev-3")],
      write: () => receipt("updated"),
    });

    const result = await upsertContentRow({ identity, deps }, input);

    expect(result.outcome).toBe("updated");
    expect(writes()[0]).toMatchObject({ expectedRowRevision: "rev-3" });
    expect(writes()[0]).not.toHaveProperty("propertyEntries");
    expect(callTool.mock.calls[1]?.[2]).toMatchObject({
      limit: 100,
      offset: 0,
      tableQuery: {
        filters: [
          { key: KEY, label: "Key", operator: "equals", value: '["TASK-1"]' },
        ],
      },
    });
  });

  it("keeps reading past rows whose key differs only in case until it finds the exact key", async () => {
    const { deps, callTool, writes } = content({
      pages: [
        Array.from({ length: 100 }, () => row("task-1")),
        [row("Task-1"), row("TASK-1", "rev-9")],
      ],
      write: () => receipt("updated"),
    });

    await upsertContentRow({ identity, deps }, input);

    expect(callTool.mock.calls[2]?.[2]).toMatchObject({ offset: 100 });
    expect(writes()[0]).toMatchObject({ expectedRowRevision: "rev-9" });
  });

  it("refuses a key that two rows hold, even when they are on different pages", async () => {
    const { deps, callTool, writes } = content({
      pages: [[row("TASK-1", "rev-1")], [row("TASK-1", "rev-2")]],
    });

    expect(
      await failure(upsertContentRow({ identity, deps }, input)),
    ).toMatchObject({
      errorCode: "content_key_duplicated",
      sideEffect: "none",
    });
    expect(callTool.mock.calls[2]?.[2]).toMatchObject({ offset: 100 });
    expect(writes()).toEqual([]);
  });

  it("stops before writing when the key lookup's answer lacks its rows, its paging, a row's one key or a row's revision", async () => {
    for (const options of [
      { noPagination: true },
      { noItems: true },
      { rows: ["not a row"] },
      { rows: [{ ...row("TASK-1"), properties: undefined }] },
      { rows: [{ ...row("TASK-1"), properties: ["not a value"] }] },
      { rows: [{ ...row("TASK-1"), properties: [] }] },
      {
        rows: [
          { ...row("TASK-1"), properties: [{ propertyId: KEY, value: 7 }] },
        ],
      },
      {
        rows: [
          {
            ...row("TASK-1"),
            properties: [
              { propertyId: KEY, value: "TASK-1" },
              { propertyId: KEY, value: "TASK-1" },
            ],
          },
        ],
      },
      { rows: [{ ...row("TASK-1"), rowRevision: undefined }] },
    ]) {
      const { deps, writes } = content(options);
      expect(
        await failure(upsertContentRow({ identity, deps }, input)),
      ).toMatchObject({
        errorCode: "content_unexpected_response",
        sideEffect: "none",
      });
      expect(writes()).toEqual([]);
    }
  });

  it("stops before writing when the collection's columns come back without an id, a name, a type or whether they can be written, or without its key column", async () => {
    const extra = (column: Record<string, unknown>) => [
      ...contract.properties,
      column,
    ];
    for (const columns of [
      undefined,
      ["not a column"],
      extra({ id: "prop-notes", type: "text", writable: true }),
      extra({ id: "prop-notes", name: "Notes", type: "text" }),
      extra({ id: "", name: "Notes", type: "text", writable: true }),
      extra({ id: "prop-notes", name: "Notes", writable: true }),
      contract.properties.filter((column) => column.id !== KEY),
    ]) {
      const { deps, writes } = content({ columns });
      expect(
        await failure(upsertContentRow({ identity, deps }, input)),
      ).toMatchObject({
        errorCode: "content_unexpected_response",
        sideEffect: "none",
      });
      expect(writes()).toEqual([]);
    }
  });

  it("creates rather than updates when the only row found has a key that differs in case", async () => {
    const { deps, writes } = content({ rows: [row("task-1")] });

    await upsertContentRow({ identity, deps }, input);

    expect(writes()[0]).toMatchObject({ expectedRowRevision: null });
  });

  it("keeps the same idempotency key for a retry of the same call, and a new one for another run", async () => {
    const first = content();
    await upsertContentRow({ identity, deps: first.deps }, input);
    await upsertContentRow({ identity, deps: first.deps }, input);
    const again = content();
    await upsertContentRow(
      { identity: { ...identity, runId: "run-2" }, deps: again.deps },
      input,
    );

    const [a, b] = first.writes().map((args) => args.idempotencyKey);
    expect(a).toBe(b);
    expect(again.writes()[0]?.idempotencyKey).not.toBe(a);
  });

  it("uses a new idempotency key when a retry finds the row the first try wrote, so Content does not refuse it as a reused key", async () => {
    const before = content();
    await upsertContentRow({ identity, deps: before.deps }, input);
    const after = content({
      rows: [row("TASK-1", "rev-4")],
      write: () => receipt("unchanged"),
    });
    await upsertContentRow({ identity, deps: after.deps }, input);

    expect(after.writes()[0]).toMatchObject({ expectedRowRevision: "rev-4" });
    expect(after.writes()[0]?.idempotencyKey).not.toBe(
      before.writes()[0]?.idempotencyKey,
    );
  });

  it("uses only the owner's personal Content connection", async () => {
    const shared = content({
      tools: contentTools("org_acme_content"),
      saved: [],
    });
    expect(
      await failure(upsertContentRow({ identity, deps: shared.deps }, input)),
    ).toMatchObject({
      errorCode: "content_not_connected",
      sideEffect: "none",
      message: expect.stringContaining(
        "has not connected Content for themselves",
      ),
    });
    expect(shared.callTool).not.toHaveBeenCalled();

    const configured = content({
      tools: contentTools("user_shared_content"),
      saved: [],
    });
    expect(
      await failure(
        upsertContentRow({ identity, deps: configured.deps }, input),
      ),
    ).toMatchObject({ errorCode: "content_not_connected" });
    expect(configured.callTool).not.toHaveBeenCalled();

    const twice = content({
      tools: [...contentTools(), ...contentTools("user_owner_content2")],
      saved: [SERVER, "user_owner_content2"],
    });
    expect(
      await failure(upsertContentRow({ identity, deps: twice.deps }, input)),
    ).toMatchObject({
      errorCode: "content_connection_ambiguous",
      message: expect.stringContaining(
        "Only the owner can fix it: in their own account,",
      ),
    });
  });

  it("tells a saved connection it cannot reach, or a failed lookup, from no connection at all", async () => {
    const partial = content({ tools: [tool(SERVER, "get-content-database")] });
    expect(
      await failure(upsertContentRow({ identity, deps: partial.deps }, input)),
    ).toMatchObject({
      errorCode: "content_connection_unavailable",
      sideEffect: "none",
      retryable: true,
      message: expect.stringMatching(
        /^The workflow's owner has a saved Content connection.*Only the owner can fix it: in their own account,/,
      ),
    });

    const broken = content();
    vi.mocked(broken.deps.listTools).mockRejectedValueOnce(
      new Error("MCP manager is not ready"),
    );
    expect(
      await failure(upsertContentRow({ identity, deps: broken.deps }, input)),
    ).toMatchObject({
      errorCode: "content_request_failed",
      sideEffect: "none",
      retryable: true,
    });
    expect(partial.callTool).not.toHaveBeenCalled();
    expect(broken.callTool).not.toHaveBeenCalled();
  });

  it("refuses a collection link on another host than the owner's connection, and links rows on the connection's host", async () => {
    const elsewhere = content();
    expect(
      await failure(
        upsertContentRow(
          { identity, deps: elsewhere.deps },
          { ...input, collection: "https://example.test/page/doc-db" },
        ),
      ),
    ).toMatchObject({ errorCode: "content_collection_other_host" });
    expect(elsewhere.callTool).not.toHaveBeenCalled();

    const byId = content();
    const result = await upsertContentRow(
      { identity, deps: byId.deps },
      { ...input, collection: "doc-db" },
    );
    expect(result.url).toBe(
      "https://beta.content.agent-native.com/page/doc-row?databaseId=db-1&databaseDocumentId=doc-db",
    );
  });

  it("refuses a column the collection lacks, cannot write, sets from the key, or is named twice, before writing", async () => {
    for (const [values, errorCode] of [
      [{ Priority: "High" }, "content_column_unknown"],
      [{ Created: "2026-11-18" }, "content_column_read_only"],
      [{ key: "TASK-2" }, "content_column_is_key"],
      [{ Status: "Done", status: "Blocked" }, "content_column_repeated"],
    ] as const) {
      const { deps, writes } = content();
      expect(
        await failure(
          upsertContentRow({ identity, deps }, { ...input, values }),
        ),
      ).toMatchObject({ errorCode, sideEffect: "none" });
      expect(writes()).toEqual([]);
    }
  });

  it("says Content refused the row when the write comes back as one of its refusals", async () => {
    for (const code of ["ROW_REVISION_CONFLICT", "SOURCE_READ_ONLY"]) {
      const { deps } = content({
        write: () => refusal(`Content said no (errorCode: ${code})`),
      });

      expect(
        await failure(upsertContentRow({ identity, deps }, input)),
      ).toMatchObject({
        errorCode: "content_write_refused",
        sideEffect: "none",
        message: expect.stringContaining(code),
      });
    }
  });

  it("says the row may have been written when the write's error is not one of Content's refusals", async () => {
    for (const text of [
      "Error: The approval could not be settled.",
      "Error: This key was used for another write (errorCode: IDEMPOTENCY_KEY_REUSED)",
    ]) {
      const { deps } = content({ write: () => refusal(text) });
      expect(
        await failure(upsertContentRow({ identity, deps }, input)),
      ).toMatchObject({
        errorCode: "content_write_outcome_unknown",
        sideEffect: "maybe",
      });
    }
  });

  it("tells a write that never left from one that may have landed", async () => {
    const unsent = content({
      write: () => {
        throw new McpAppApiError(
          "MCP tool is not available in this request scope.",
          403,
        );
      },
    });
    const lost = content({
      write: () => {
        throw new Error("socket hang up");
      },
    });
    const unreadable = content({
      write: () => ({
        content: [
          { type: "text", text: "upsert completed. Its result is not shown." },
        ],
      }),
    });

    expect(
      await failure(upsertContentRow({ identity, deps: lost.deps }, input)),
    ).toMatchObject({
      errorCode: "content_write_outcome_unknown",
      sideEffect: "maybe",
    });
    expect(
      await failure(
        upsertContentRow({ identity, deps: unreadable.deps }, input),
      ),
    ).toMatchObject({
      errorCode: "content_write_outcome_unknown",
      sideEffect: "maybe",
    });
    expect(
      await failure(upsertContentRow({ identity, deps: unsent.deps }, input)),
    ).toMatchObject({
      errorCode: "content_request_failed",
      sideEffect: "none",
      retryable: true,
    });
  });

  it("refuses a page that is not a collection it can write to, or one without a key", async () => {
    const page = content();
    page.callTool.mockResolvedValueOnce(answer({ items: [] }));
    expect(
      await failure(upsertContentRow({ identity, deps: page.deps }, input)),
    ).toMatchObject({ errorCode: "content_collection_not_writable" });

    const keyless = content();
    keyless.callTool.mockResolvedValueOnce(
      answer({
        mutationContract: { ...contract, naturalKeyPropertyId: null },
        items: [],
      }),
    );
    expect(
      await failure(upsertContentRow({ identity, deps: keyless.deps }, input)),
    ).toMatchObject({ errorCode: "content_key_missing" });
  });
});

describe("what content.upsertRow declares", () => {
  it("is what the host returns, with externalRef added by the engine", async () => {
    const def = OPERATION_CATALOG.get("content.upsertRow");
    if (!def) throw new Error("content.upsertRow is not in the catalog");
    const declared = (operationOutputs(def) ?? [])
      .map((output) => output.name)
      .filter((name) => name !== "externalRef")
      .sort();
    const { deps } = content();

    const result = await upsertContentRow({ identity, deps }, input);

    expect(Object.keys(result).sort()).toEqual(declared);
  });
});
