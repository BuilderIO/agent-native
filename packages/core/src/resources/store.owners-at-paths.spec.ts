import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { DbExec } from "../db/client.js";

vi.mock("../db/client.js", () => ({
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

describe("resourceOwnersAtPaths", () => {
  it("lists who keeps a resource at each path, across owner batches, without hidden agent files", async () => {
    const { resourceOwnersAtPaths, resourcePut } = await import("./store.js");
    await resourcePut("Alice@Example.test", "skills/a/SKILL.md", "a");
    await resourcePut("bob@example.test", "skills/b/SKILL.md", "b");
    await resourcePut(
      "carol@example.test",
      "skills/a/SKILL.md",
      "a",
      undefined,
      {
        visibility: "agent_scratch",
      },
    );
    await resourcePut("dave@example.test", "skills/other/SKILL.md", "other");
    await resourcePut("zed@example.test", "skills/a/SKILL.md", "a");

    // 400 owners fit in one query, so zed is only found by the second.
    const others = Array.from(
      { length: 400 },
      (_, index) => `member-${index}@example.test`,
    );
    const found = await resourceOwnersAtPaths(
      [
        " alice@example.test ",
        "bob@example.test",
        "carol@example.test",
        "dave@example.test",
        ...others,
        "zed@example.test",
      ],
      ["skills/a/SKILL.md", "skills/b/SKILL.md"],
    );

    expect([...found].sort((x, y) => x.owner.localeCompare(y.owner))).toEqual([
      { owner: "alice@example.test", path: "skills/a/SKILL.md" },
      { owner: "bob@example.test", path: "skills/b/SKILL.md" },
      { owner: "zed@example.test", path: "skills/a/SKILL.md" },
    ]);
  });
});
