import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";

let postgres: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await postgres.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = postgres.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isConnectionError: () => false,
  isLocalDatabase: () => true,
  isProductionServerlessFunctionRuntime: () => false,
}));

vi.mock("./emitter.js", () => ({
  emitAppStateChange: () => {},
  emitAppStateDelete: () => {},
}));

const {
  browserTabUsedKey,
  findLastUsedBrowserTab,
  LAST_USED_BROWSER_TAB_MAX_AGE_MS,
} = await import("./last-used-tab.js");

const SESSION = "alice@example.com";
const NOW = 1_800_000_000_000;

async function used(
  key: string,
  updatedAt: number,
  sessionId = SESSION,
): Promise<void> {
  await rawClient.execute({
    sql: `INSERT INTO application_state (session_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
    args: [sessionId, key, JSON.stringify({ usedAt: 0 }), updatedAt],
  });
}

function useApp(id: string): void {
  resetAppConfigForTests();
  defineAppConfig({ app: { id } });
}

beforeEach(async () => {
  useApp("design");
  postgres = await createTestPglite();
  await postgres.exec(`CREATE TABLE IF NOT EXISTS application_state (
    session_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (session_id, key)
  )`);
});

afterEach(async () => {
  await postgres.close();
  resetAppConfigForTests();
});

describe("the last-used browser tab", () => {
  it("files each tab's use under its app, so apps sharing a database stay apart", () => {
    expect(browserTabUsedKey("tab-a")).toBe("browser-tab-used:design:tab-a");
    useApp("slides");
    expect(browserTabUsedKey("tab-a")).toBe("browser-tab-used:slides:tab-a");
  });

  it("picks the tab the server recorded a use for most recently", async () => {
    await used(browserTabUsedKey("tab-a"), NOW - 60_000);
    await used(browserTabUsedKey("tab-b"), NOW - 5_000);
    await used(browserTabUsedKey("tab-c"), NOW - 3_600_000);

    await expect(findLastUsedBrowserTab(SESSION, NOW)).resolves.toEqual({
      kind: "last-used",
      tabId: "tab-b",
      usedAt: NOW - 5_000,
    });
  });

  it("ignores tabs of another app, another user, or used too long ago", async () => {
    await used(
      browserTabUsedKey("design-old"),
      NOW - LAST_USED_BROWSER_TAB_MAX_AGE_MS - 1,
    );
    await used(browserTabUsedKey("design-bob"), NOW - 1_000, "bob@example.com");
    useApp("slides");
    await used(browserTabUsedKey("slides-new"), NOW - 1_000);
    useApp("design");

    await expect(findLastUsedBrowserTab(SESSION, NOW)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("doesn't match an app whose name only starts with this one's", async () => {
    useApp("design-preview");
    await used(browserTabUsedKey("tab-a"), NOW - 1_000);
    useApp("design");

    await expect(findLastUsedBrowserTab(SESSION, NOW)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("skips a record whose tab id isn't one a browser sends", async () => {
    await used("browser-tab-used:design:bad tab", NOW - 1_000);
    await used("browser-tab-used:design:", NOW - 1_000);

    await expect(findLastUsedBrowserTab(SESSION, NOW)).resolves.toEqual({
      kind: "unavailable",
    });
  });
});
