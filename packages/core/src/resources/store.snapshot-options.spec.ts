import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

vi.mock("../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: DbExec = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = {
    async execute(input) {
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const result = await pglite.query(input.sql, [...(input.args ?? [])]);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
    transaction: pglite.transaction,
  };
});

afterAll(async () => {
  await pglite.close();
});

const owner = "erin@example.test";
const HOUR = 60 * 60 * 1000;

async function storeWith(
  path: string,
  visibility: string,
  expiresAt: number | null,
) {
  const { ensureResourceStoreReady, resourceGetByPath } =
    await import("./store.js");
  await ensureResourceStoreReady();
  await pglite.query(
    `INSERT INTO resources (id, path, owner, content, created_at, updated_at, visibility, thread_id, run_id, expires_at)
     VALUES ($1, $2, $3, 'before', 1, 1, $4, 'thread-1', 'run-1', $5)`,
    [path, path, owner, visibility, expiresAt],
  );
  const previous = await resourceGetByPath(owner, path);
  expect(previous).not.toBeNull();
  if (!previous) throw new Error(`No resource at ${path}`);
  return previous;
}

describe("resourcePutIfSnapshot options", () => {
  it("keeps where the file shows when the write doesn't say", async () => {
    const { resourcePutIfSnapshot } = await import("./store.js");
    const expiresAt = Date.now() + HOUR;
    const previous = await storeWith(
      "notes/scratch.md",
      "agent_scratch",
      expiresAt,
    );

    const written = await resourcePutIfSnapshot({
      previous,
      owner,
      path: previous.path,
      content: "after",
    });

    expect(written?.resource).toMatchObject({
      content: "after",
      visibility: "agent_scratch",
      threadId: "thread-1",
      runId: "run-1",
      expiresAt,
    });
  });

  it("makes a scratch file a kept one, as an ordinary write would", async () => {
    const { resourcePutIfSnapshot } = await import("./store.js");
    const previous = await storeWith(
      "notes/kept.md",
      "agent_scratch",
      Date.now() + HOUR,
    );

    const written = await resourcePutIfSnapshot({
      previous,
      owner,
      path: previous.path,
      content: "after",
      options: { visibility: "workspace" },
    });

    expect(written?.resource).toMatchObject({
      visibility: "workspace",
      threadId: "thread-1",
      runId: "run-1",
      expiresAt: null,
    });
  });

  it("gives a file made scratch the scratch expiry", async () => {
    const { resourcePutIfSnapshot } = await import("./store.js");
    const previous = await storeWith("notes/working.md", "workspace", null);

    const written = await resourcePutIfSnapshot({
      previous,
      owner,
      path: previous.path,
      content: "after",
      options: { visibility: "agent_scratch", threadId: "thread-2" },
    });

    expect(written?.resource).toMatchObject({
      visibility: "agent_scratch",
      threadId: "thread-2",
      runId: "run-1",
    });
    expect(written?.resource.expiresAt).toBe(
      (written?.resource.updatedAt ?? 0) + 24 * HOUR,
    );
  });
});
