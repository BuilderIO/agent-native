/**
 * The realtime registration row must be invisible to the settings watermark.
 *
 * `wireLocalEmitters` already skips that key so the isolate that writes it fans
 * out nothing. The cross-instance external-change detector is the other half:
 * it has no key filter, so a bare `MAX(updated_at)` advancing makes every OTHER
 * live isolate record a durable `key:"*"` settings change and invalidate every
 * connected client's settings queries — for a write none of them can see.
 */

import { describe, expect, it, vi } from "vitest";

import { REALTIME_REGISTRATION_SETTING_KEY } from "../realtime-registration-key.js";
import { AppSyncState } from "./poll.js";

const ACTION_MARKER_KEY = "__action_change__";

/**
 * A settings table whose newest row is the hidden registration write.
 * `settingsMax` answers a watermark query that can see every key;
 * `filteredMax` answers one that excludes the registration key.
 */
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
      // A non-zero action marker keeps `seedVersionFromDb` from arming the
      // detector's one-second throttle, so the check below actually runs.
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
    isPostgres: () => false,
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
    // The filter must exclude one key, not disable the detector.
    const { state, max } = makeState({
      settingsMax: 1_000,
      filteredMax: 1_000,
    });
    await state.seedVersionFromDb();
    const baseline = state.getVersion();

    // An ordinary settings row, which the filtered watermark does see.
    max.settingsMax = 9_000;
    max.filteredMax = 9_000;
    await state.checkExternalDbChanges({ durableEvents: false });

    expect(state.getChangesSince(baseline).events).toEqual([
      expect.objectContaining({ source: "settings", key: "*" }),
    ]);
  });
});
