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

const user = { scope: "user", scopeId: "erin@example.test" } as const;

describe("appendWorkspaceFile against the database", () => {
  it("keeps every line when appends run at once", async () => {
    const { appendWorkspaceFile, readWorkspaceFile } =
      await import("./store.js");

    await appendWorkspaceFile(user, "notes/log.md", "start\n");
    await Promise.all(
      ["one\n", "two\n", "three\n"].map((line) =>
        appendWorkspaceFile(user, "notes/log.md", line),
      ),
    );

    const file = await readWorkspaceFile(user, "notes/log.md");
    const lines = file?.content.split("\n").filter(Boolean) ?? [];
    expect(lines[0]).toBe("start");
    expect([...lines].sort()).toEqual(["one", "start", "three", "two"]);
  });
});
