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
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue(result),
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    return query;
  };
  const db: Record<string, any> = {
    select: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
  };
  const tx: Record<string, any> = {
    select: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
    execute: vi.fn(async () => {
      events.push(
        events.includes("design-lock") ? "index-lock" : "design-lock",
      );
      return { rows: [] };
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
    getText: vi.fn(),
    hasCollabState: vi.fn(),
    schema,
    selectResults,
    tx,
    withSourceFileWriteLock: vi.fn(
      async (_id: string, run: () => Promise<unknown>) => {
        events.push("source-lock");
        return run();
      },
    ),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/collab", () => ({
  getText: harness.getText,
  hasCollabState: harness.hasCollabState,
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
  withSourceFileWriteLock: harness.withSourceFileWriteLock,
}));
vi.mock("../shared/capability-resolver.js", () => ({
  resolveSourceCapabilities: () => ({}),
}));
vi.mock("../shared/code-layer.js", () => ({
  buildCodeLayerProjection: () => ({ nodes: [{ id: "node" }] }),
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
    harness.db.transaction.mockClear();
    harness.getText.mockReset();
    harness.hasCollabState.mockResolvedValue(true);
    harness.tx.execute.mockClear();
    harness.tx.insert.mockClear();
    harness.tx.update.mockClear();
    harness.getText.mockImplementation(async () => {
      harness.events.push("get-text");
      return '<main data-agent-native-component="Card"></main>';
    });
  });

  it("takes the source lock before SQL locks and live collab reads", async () => {
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
      [],
    );

    await action.run({ designId: "design-1", fileId: "file-1" });

    expect(harness.events).toEqual([
      "source-lock",
      "get-text",
      "transaction",
      "design-lock",
      "index-lock",
    ]);
  });

  it("fails typed when live collab content cannot be verified", async () => {
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
    harness.getText.mockRejectedValue(new Error("collab unavailable"));

    await expect(
      action.run({ designId: "design-1", fileId: "file-1" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(harness.tx.insert).not.toHaveBeenCalled();
  });
});
