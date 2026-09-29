import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: executeMock }),
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

  it("lists configs only for the requested platform with a bounded query", async () => {
    const { listIntegrationConfigPage } = await import("./config-store.js");
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          platform: "google-docs",
          config_key: "watch-channel",
          config_data: '{"channelId":"channel-a"}',
          owner: "alice@example.test",
          updated_at: 100,
        },
      ],
    });

    await expect(
      listIntegrationConfigPage({ platform: "google-docs" }),
    ).resolves.toMatchObject({
      configs: [
        {
          platform: "google-docs",
          configKey: "watch-channel",
          configData: { channelId: "channel-a" },
          owner: "alice@example.test",
          updatedAt: 100,
        },
      ],
      nextCursor: null,
    });
    expect(executeMock).toHaveBeenCalledWith({
      sql: expect.stringContaining("FROM integration_configs"),
      args: ["google-docs", 101],
    });
    expect(executeMock.mock.calls.at(-1)?.[0].sql).toContain("LIMIT ?");
  });

  it("returns the full legacy list through bounded pages", async () => {
    const { listIntegrationConfigs } = await import("./config-store.js");
    const rows = Array.from({ length: 101 }, (_, index) => ({
      platform: "platform-a",
      config_key: `key-${String(index).padStart(3, "0")}`,
      config_data: "{}",
      owner: null,
      updated_at: index,
    }));
    executeMock
      .mockResolvedValueOnce({ rows, rowsAffected: 0 })
      .mockResolvedValueOnce({ rows: [rows[100]!], rowsAffected: 0 });

    await expect(listIntegrationConfigs()).resolves.toHaveLength(101);
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[0]?.[0]).toMatchObject({
      sql: expect.stringContaining("LIMIT ?"),
      args: [101],
    });
    expect(executeMock.mock.calls[1]?.[0]).toMatchObject({
      sql: expect.stringContaining("LIMIT ?"),
      args: ["platform-a", "platform-a", "key-099", 101],
    });
  });
});
