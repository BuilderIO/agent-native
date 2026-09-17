/**
 * Tests for index-components action.
 *
 * Issue: the action was declared readOnly:true / GET but inserts and updates
 * component_index rows. It must be a write action (readOnly:false / POST) that
 * requires editor access.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const events: string[] = [];
  const selectResults: unknown[][] = [];
  const executeResults: unknown[][] = [];
  const projectionInputs: string[] = [];
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
    select: vi.fn(() => {
      events.push("design-file-lock");
      return makeQuery(selectResults.shift() ?? []);
    }),
    execute: vi.fn(async (query: unknown) => {
      const sql =
        typeof query === "string"
          ? query
          : String((query as { sql?: unknown })?.sql ?? "");
      events.push(
        sql.includes("pg_advisory_xact_lock")
          ? "design-lock"
          : sql.includes("_collab_docs")
            ? "collab-lock"
            : sql.includes("component_index")
              ? "index-upsert"
              : "execute",
      );
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      return { rows: executeResults.shift() ?? [] };
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
  return {
    db,
    events,
    executeResults,
    projectionInputs,
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
        run: () => Promise<unknown>,
      ) => {
        events.push("prepared-lock");
        return run();
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
  withPreparedYDocMutation: harness.withPreparedYDocMutation,
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
    { name: "Card", instanceId: "node", selector: "[data-node=node]" },
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
    harness.projectionInputs.length = 0;
    harness.db.transaction.mockClear();
    harness.withPreparedYDocMutation.mockClear();
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
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: "<main></main>",
        },
      ],
    );

    await action.run({ designId: "design-1", fileId: "file-1" });

    expect(harness.events).toEqual([
      "source-lock",
      "prepared-lock",
      "transaction",
      "design-lock",
      "design-file-lock",
      "collab-lock",
      "index-upsert",
    ]);
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
        yjs_state: "state-v2",
        text_snapshot:
          '<main data-agent-native-component="Card"><span /></main>',
      },
    ]);

    await action.run({ designId: "design-1", fileId: "file-1" });
    expect(harness.projectionInputs).toEqual([
      '<main data-agent-native-component="Card"><span /></main>',
    ]);
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
      [
        {
          id: "file-1",
          designId: "design-1",
          filename: "index.html",
          content: '<main data-agent-native-component="Card"></main>',
        },
      ],
    );
    harness.executeResults.push([{ yjs_state: "state", text_snapshot: null }]);

    await expect(
      action.run({ designId: "design-1", fileId: "file-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(harness.tx.execute).toHaveBeenCalledTimes(2);
    expect(harness.events).not.toContain("index-upsert");
  });
});
