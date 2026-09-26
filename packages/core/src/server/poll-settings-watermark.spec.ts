
import { describe, expect, it, vi } from "vitest";

import { REALTIME_REGISTRATION_SETTING_KEY } from "../realtime-registration-key.js";
import { AppSyncState } from "./poll.js";

const ACTION_MARKER_KEY = "__action_change__";

function makeState(opts: { settingsMax: number; filteredMax: number }) {
  const settingsQueries: Array<{ sql: string; args: unknown[] }> = [];
  const max = { ...opts };
  const execute = vi.fn(
    async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === "string" ? query : query.sql;
      const args = typeof query === "string" ? [] : (query.args ?? []);
      if (/max\(updated_at\)/i.test(sql) && sql.includes("settings")) {
        settingsQueries.push({ sql, args });
        return {
          rows: [
            {
              max_ts: args.includes(REALTIME_REGISTRATION_SETTING_KEY)
                ? max.filteredMax
                : max.settingsMax,
            },
          ],
          rowsAffected: 0,
        };
      }
      if (/max\(updated_at\)/i.test(sql)) {
        return {
          rows: [{ max_ts: args[0] === ACTION_MARKER_KEY ? 500 : 0 }],
          rowsAffected: 0,
        };
      }
      return { rows: [], rowsAffected: 0 };
    },
  );
  const state = new AppSyncState({
    getDb: () => ({ execute }) as never,
  });
  return { state, settingsQueries, max };
}

describe("settings watermark", () => {
  it("does not fan out a global invalidation for the registration write", async () => {
    const { state, settingsQueries } = makeState({
      settingsMax: 5_000,
      filteredMax: 1_000,
    });
    await state.seedVersionFromDb();
    const baseline = state.getVersion();

    await state.checkExternalDbChanges({ durableEvents: false });

    expect(settingsQueries.length).toBeGreaterThan(0);
    for (const query of settingsQueries) {
      expect(query.args).toContain(REALTIME_REGISTRATION_SETTING_KEY);
    }
    expect(state.getChangesSince(baseline).events).toEqual([]);
  });

  it("still fans out for an ordinary settings write", async () => {
    const { state, max } = makeState({
      settingsMax: 1_000,
      filteredMax: 1_000,
    });
    await state.seedVersionFromDb();
    const baseline = state.getVersion();

    max.settingsMax = 9_000;
    max.filteredMax = 9_000;
    await state.checkExternalDbChanges({ durableEvents: false });

    expect(state.getChangesSince(baseline).events).toEqual([
      expect.objectContaining({ source: "settings", key: "*" }),
    ]);
  });
});
