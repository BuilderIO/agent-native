import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const events: string[] = [];
  const selectResults: unknown[][] = [];
  const executeResults: unknown[][] = [];
  const projectionInputs: string[] = [];
  const persistedSnapshots: string[] = [];
  let preparedText = "";
  let persistError: unknown;
  const CollabBaseVersionConflictError = class extends Error {
    readonly statusCode = 409;
  };
  const schema = {
    componentIndex: { id: "componentIndex.id" },
    designFiles: {
      id: "designFiles.id",
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
    },
    designs: { id: "designs.id" },
    designShares: {},
  };
  const makeQuery = (result: unknown[]) => {
    const query = {
      from: vi.fn(),
      for: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue(result),
    };
    query.from.mockReturnValue(query);
    query.for.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    return query;
  };
  const db: Record<string, any> = {
    select: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
  };
  const tx: Record<string, any> = {
    execute: vi.fn(async (query: unknown) => {
      const sql =
        typeof query === "string"
          ? query
          : String((query as { sql?: unknown })?.sql ?? "");
      events.push(
        sql.includes("pg_advisory_xact_lock")
          ? "design-lock"
          : sql.includes("FROM design_files")
            ? "design-file-lock"
            : sql.includes("_collab_docs")
              ? "collab-lock"
              : sql.includes("component_index")
                ? "index-upsert"
                : "execute",
      );
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      const rows = executeResults.shift() ?? [];
      return { rows };
    }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  };
  db.transaction = vi.fn(async (run: (value: unknown) => Promise<unknown>) => {
    events.push("transaction");
    return run(tx);
  });
  const lease = {
    doc: {},
    baseVersion: null as number | null,
    persist: vi.fn(async (_transaction: unknown, text: string) => {
      events.push("collab-seed");
      persistedSnapshots.push(text);
      if (persistError) throw persistError;
    }),
  };
  return {
    CollabBaseVersionConflictError,
    applyTextToYDoc: vi.fn(
      (_doc: unknown, _fieldName: string, text: string) => {
        preparedText = text;
      },
    ),
    db,
    events,
    executeResults,
    lease,
    persistedSnapshots,
    projectionInputs,
    getPreparedText: () => preparedText,
    resetPreparedText: () => {
      preparedText = "";
    },
    setPreparedText: (text: string) => {
      preparedText = text;
    },
    setLeaseBaseVersion: (version: number | null) => {
      lease.baseVersion = version;
    },
    lockPreparedSourceCollaboration: vi.fn(
      async (
        transaction: { execute(query: unknown): Promise<{ rows: unknown[] }> },
        fileId: string,
        preparedLease: { baseVersion: number | null },
      ) => {
        const result = await transaction.execute({
          sql: "SELECT yjs_state, text_snapshot, version FROM _collab_docs WHERE doc_id = ? FOR UPDATE",
          args: [fileId],
        });
        const row = result.rows[0] as
          | {
              yjs_state?: unknown;
              text_snapshot?: unknown;
              version?: unknown;
            }
          | undefined;
        if (!row) {
          if (preparedLease.baseVersion !== null) {
            const error = new Error("stale prepared lease") as Error & {
              statusCode?: number;
            };
            error.statusCode = 409;
            throw error;
          }
          return { hasState: false, needsSeed: true };
        }
        const version = Number(row.version);
        if (
          typeof row.yjs_state !== "string" ||
          typeof row.text_snapshot !== "string" ||
          !Number.isSafeInteger(version) ||
          version !== preparedLease.baseVersion
        ) {
          const error = new Error("stale prepared lease") as Error & {
            statusCode?: number;
          };
          error.statusCode = 409;
          throw error;
        }
        const hasState = row.yjs_state.length > 0;
        return { hasState, needsSeed: !hasState };
      },
    ),
    setPersistError: (error: unknown) => {
      persistError = error;
    },
    schema,
    selectResults,
    tx,
    withSourceFileWriteLock: vi.fn(
      async (_id: string, run: () => Promise<unknown>) => {
        events.push("source-lock");
        return run();
      },
    ),
    withPreparedYDocMutation: vi.fn(
      async (
        _id: string,
        _source: string | undefined,
        run: (lease: unknown) => Promise<unknown>,
      ) => {
        events.push("prepared-lock");
        return run(lease);
      },
    ),
    withPreparedSourceFileMutation: vi.fn(
      async (
        _id: string,
        _source: string | undefined,
        run: (lease: unknown) => Promise<unknown>,
      ) => {
        events.push("source-lock", "prepared-lock");
        return run(lease);
      },
    ),
    designSourceMutationLockKey: vi.fn(
      (designId: string) => `agent-native:design-source:${designId}`,
    ),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/collab", () => ({
  applyTextToYDoc: harness.applyTextToYDoc,
  CollabBaseVersionConflictError: harness.CollabBaseVersionConflictError,
  withPreparedYDocMutation: harness.withPreparedYDocMutation,
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ transaction: harness.db.transaction }),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "user@example.com",
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ access: true }),
  assertAccess: vi.fn().mockResolvedValue({
    resource: {
      data: JSON.stringify({ sourceType: "inline" }),
      ownerEmail: "owner@example.com",
    },
  }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => ({ parts }),
  eq: (left: unknown, right: unknown) => ({ left, right }),
  sql: (strings: TemplateStringsArray) => strings.join(""),
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => harness.db,
  schema: harness.schema,
}));
vi.mock("../server/source-workspace.js", () => ({
  SourceWorkspaceEditConflictError: class SourceWorkspaceEditConflictError extends Error {
    readonly statusCode = 409;
  },
  designSourceMutationLockKey: harness.designSourceMutationLockKey,
  lockPreparedSourceCollaboration: harness.lockPreparedSourceCollaboration,
  readPreparedSourceText: () => harness.getPreparedText(),
  withPreparedSourceFileMutation: harness.withPreparedSourceFileMutation,
  withSourceFileWriteLock: harness.withSourceFileWriteLock,
}));
vi.mock("../shared/capability-resolver.js", () => ({
  resolveSourceCapabilities: () => ({}),
}));
vi.mock("../shared/code-layer.js", () => ({
  buildCodeLayerProjection: (html: string) => {
    harness.projectionInputs.push(html);
    return { nodes: [{ id: "node" }] };
  },
}));
vi.mock("../shared/component-model.js", () => ({
  buildDefinitions: () => [{ name: "Card", instanceNodeIds: ["node"] }],
  componentIndexId: (designId: string, name: string) =>
    `ci_${designId}_${name}`,
  detectInstances: () => [
    {
      name: "Card",
      instanceId: "node",
      nodeId: "node",
      selector: "[data-node=node]",
    },
  ],
}));
vi.mock("../shared/design-source-capabilities.js", () => ({
  hasCapability: () => false,
}));
vi.mock("../shared/source-mode.js", () => ({
  designSourceTypeFromData: () => "inline",
}));

import action from "./index-components.js";

describe("index-components action metadata", () => {
  it("is NOT read-only (it writes component_index rows)", () => {
    expect((action as { readOnly?: boolean }).readOnly).toBe(false);
  });

  it("uses HTTP POST (not GET) because it persists data", () => {
    const http = (action as { http?: { method?: string } }).http;
    expect(http?.method).toBe("POST");
  });
});

describe("index-components source ordering", () => {
  beforeEach(() => {
    harness.events.length = 0;
    harness.selectResults.length = 0;
    harness.executeResults.length = 0;
    harness.persistedSnapshots.length = 0;
    harness.projectionInputs.length = 0;
    harness.resetPreparedText();
    harness.setLeaseBaseVersion(null);
    harness.setPersistError(undefined);
    harness.applyTextToYDoc.mockClear();
    harness.lease.persist.mockClear();
    harness.db.transaction.mockClear();
    harness.withPreparedYDocMutation.mockClear();
    harness.withPreparedSourceFileMutation.mockClear();
    harness.tx.execute.mockClear();
    harness.tx.insert.mockClear();
    harness.tx.update.mockClear();
  });

  it("takes the source lock before the protected live read", async () => {
    harness.selectResults.push(
      [{ id: "file-1" }],
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: "<main></main>",
        },
      ],
    );
    harness.executeResults.push([
      {
        id: "file-1",
        designId: "design-1",
        filename: "index.html",
        content: "<main></main>",
      },
    ]);

    await action.run({ designId: "design-1", fileId: "file-1" });

    expect(harness.events).toEqual([
      "source-lock",
      "prepared-lock",
      "transaction",
      "design-lock",
      "design-file-lock",
      "collab-lock",
      "collab-seed",
      "index-upsert",
    ]);
    expect(harness.applyTextToYDoc).toHaveBeenCalledWith(
      harness.lease.doc,
      "content",
      "<main></main>",
      "agent",
    );
    expect(harness.persistedSnapshots).toEqual(["<main></main>"]);
    expect(
      harness.tx.execute.mock.calls.map(([query]: [unknown]) =>
        String((query as { sql?: unknown })?.sql ?? query),
      ),
    ).not.toContainEqual(expect.stringContaining("LOCK TABLE"));
  });

  it("uses the locked live snapshot instead of a stale preflight", async () => {
    harness.selectResults.push(
      [{ id: "file-1" }],
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: "<main></main>",
        },
      ],
    );
    harness.executeResults.push(
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: "<main></main>",
        },
      ],
      [
        {
          yjs_state: "state-v2",
          text_snapshot: "<main>stale SQL snapshot</main>",
          version: 0,
        },
      ],
    );
    harness.setLeaseBaseVersion(0);
    harness.setPreparedText(
      '<main data-agent-native-component="Card"><span /></main>',
    );

    await action.run({ designId: "design-1", fileId: "file-1" });
    expect(harness.projectionInputs).toEqual([
      '<main data-agent-native-component="Card"><span /></main>',
    ]);
  });

  it("rejects a prepared projection when the durable collaboration version advanced", async () => {
    harness.selectResults.push(
      [{ id: "file-1" }],
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: "<main></main>",
        },
      ],
    );
    harness.executeResults.push(
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: "<main></main>",
        },
      ],
      [
        {
          yjs_state: "state-v3",
          text_snapshot: "<main>peer edit</main>",
          version: 3,
        },
      ],
    );
    harness.setLeaseBaseVersion(2);
    harness.setPreparedText(
      '<main data-agent-native-component="StaleLease"></main>',
    );

    await expect(
      action.run({ designId: "design-1", fileId: "file-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(harness.projectionInputs).toEqual([]);
    expect(harness.events).not.toContain("index-upsert");
  });

  it("seeds an existing empty collaboration row before projecting", async () => {
    const html = '<main data-agent-native-component="Card"></main>';
    harness.selectResults.push(
      [{ id: "file-1" }],
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: html,
        },
      ],
    );
    harness.executeResults.push(
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: html,
        },
      ],
      [{ yjs_state: "", text_snapshot: "", version: 4 }],
    );
    harness.setLeaseBaseVersion(4);

    await action.run({ designId: "design-1", fileId: "file-1" });

    expect(harness.applyTextToYDoc).toHaveBeenCalledWith(
      harness.lease.doc,
      "content",
      html,
      "agent",
    );
    expect(harness.persistedSnapshots).toEqual([html]);
    expect(harness.projectionInputs).toEqual([html]);
  });

  it("persists authored selectors instead of generated projection ids", async () => {
    harness.selectResults.push(
      [{ id: "file-1" }],
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: '<main data-agent-native-component="Card"></main>',
        },
      ],
    );
    harness.executeResults.push(
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: '<main data-agent-native-component="Card"></main>',
        },
      ],
      [],
    );

    await action.run({ designId: "design-1", fileId: "file-1" });

    const indexUpsert = harness.tx.execute.mock.calls.find(([query]) =>
      String((query as { sql?: unknown })?.sql ?? query).includes(
        "component_index",
      ),
    );
    expect(indexUpsert?.[0]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining([JSON.stringify(["[data-node=node]"])]),
      }),
    );
    expect(JSON.stringify(indexUpsert?.[0])).not.toContain(
      '[data-agent-native-node-id="node"]',
    );
  });

  it("fails typed when another writer wins lazy collab initialization", async () => {
    harness.selectResults.push(
      [{ id: "file-1" }],
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: '<main data-agent-native-component="Card"></main>',
        },
      ],
    );
    harness.executeResults.push(
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: '<main data-agent-native-component="Card"></main>',
        },
      ],
      [],
    );
    harness.setPersistError(
      new harness.CollabBaseVersionConflictError(
        "concurrent lazy initialization",
      ),
    );

    await expect(
      action.run({ designId: "design-1", fileId: "file-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(harness.projectionInputs).toEqual([]);
    expect(harness.events).not.toContain("index-upsert");
  });

  it("fails typed when the locked live snapshot cannot be verified", async () => {
    harness.selectResults.push(
      [{ id: "file-1" }],
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: '<main data-agent-native-component="Card"></main>',
        },
      ],
    );
    harness.executeResults.push(
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: '<main data-agent-native-component="Card"></main>',
        },
      ],
      [{ yjs_state: "state", text_snapshot: null, version: 0 }],
    );
    harness.setLeaseBaseVersion(0);

    await expect(
      action.run({ designId: "design-1", fileId: "file-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(harness.tx.execute).toHaveBeenCalledTimes(3);
    expect(harness.events).not.toContain("index-upsert");
  });
});
