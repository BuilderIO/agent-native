import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  isPostgres: () => true,
  intType: () => "BIGINT",
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

describe("resourceListContentByOwnersAndPrefixes", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockImplementation(
      async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === "string" ? input : input.sql;
        if (sql.includes("SELECT id, path, owner, content FROM resources")) {
          return {
            rows: [
              {
                id: "manifest-1",
                path: "remote-agents/custom.json",
                owner: "__shared__",
                content: '{"id":"custom"}',
              },
            ],
            rowsAffected: 0,
          };
        }
        return { rows: [], rowsAffected: 0 };
      },
    );
  });

  it("uses one projected manifest query on an initialized database", async () => {
    const { resourceListContentByOwnersAndPrefixes } =
      await import("./store.js");

    await expect(
      resourceListContentByOwnersAndPrefixes(
        ["__shared__", "__organization__:org-123"],
        ["agents/", "remote-agents/"],
      ),
    ).resolves.toEqual([
      {
        id: "manifest-1",
        path: "remote-agents/custom.json",
        owner: "__shared__",
        content: '{"id":"custom"}',
      },
    ]);

    const blockingSelects = executeMock.mock.calls
      .map(([input]) => (typeof input === "string" ? input : input.sql))
      .filter((sql) => /^\s*SELECT/i.test(sql));
    expect(blockingSelects).toHaveLength(1);
    expect(blockingSelects[0]).toContain("owner IN (?, ?)");
    expect(blockingSelects[0]).toContain("path LIKE ? ESCAPE '!'");
  });

  it("reports transient database failure without entering schema repair", async () => {
    executeMock.mockRejectedValue(new Error("connection reset"));
    const { resourceListContentByOwnersAndPrefixes } =
      await import("./store.js");

    await expect(
      resourceListContentByOwnersAndPrefixes(
        ["__shared__"],
        ["remote-agents/"],
      ),
    ).rejects.toThrow("connection reset");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
