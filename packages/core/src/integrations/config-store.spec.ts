import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
  intType: () => "BIGINT",
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(),
}));

describe("integration config compare-and-swap", () => {
  let currentRevision = 100;

  beforeEach(() => {
    currentRevision = 100;
    executeMock.mockReset();
    executeMock.mockImplementation(
      async (input: string | { sql: string; args?: unknown[] }) => {
        if (typeof input === "string") return { rows: [], rowsAffected: 0 };

        if (input.sql.startsWith("UPDATE integration_configs")) {
          const expectedRevision = input.args?.at(-1);
          if (expectedRevision !== currentRevision) {
            return { rows: [], rowsAffected: 0 };
          }
          currentRevision += 1;
          return { rows: [], rowsAffected: 1 };
        }

        return { rows: [], rowsAffected: 0 };
      },
    );
  });

  it("allows only one writer from a snapshot even when the clock repeats", async () => {
    const { saveIntegrationConfigIfUnchanged } =
      await import("./config-store.js");
    const expected = {
      platform: "google-docs",
      configKey: "watch-channel",
      configData: { channelId: "channel-a" },
      owner: null,
      updatedAt: 100,
    };

    const results = await Promise.all([
      saveIntegrationConfigIfUnchanged(
        "google-docs",
        { channelId: "channel-b" },
        "watch-channel",
        expected,
      ),
      saveIntegrationConfigIfUnchanged(
        "google-docs",
        { channelId: "channel-c" },
        "watch-channel",
        expected,
      ),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(currentRevision).toBe(101);
    const updateCalls = executeMock.mock.calls.filter(
      ([input]) =>
        typeof input !== "string" &&
        input.sql.startsWith("UPDATE integration_configs"),
    );
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]?.[0]).toEqual(
      expect.objectContaining({
        sql: expect.stringContaining("updated_at = updated_at + 1"),
      }),
    );
  });
});
