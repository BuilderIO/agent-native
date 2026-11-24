import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineAction, noteExternalWrite } from "@agent-native/core/action";
import {
  AgentNavigationRefusedError,
  appStateDelete,
  appStateGet,
  appStatePut,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import navigate from "./navigate.js";

const USER_EMAIL = "person@example.com";
const TAB_ID = "calendar-tab-1";
const TEMP_DB_DIR = mkdtempSync(join(tmpdir(), "calendar-navigate-keepview-"));
const PREVIOUS_DB_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = `pglite:${TEMP_DB_DIR}`;

const WEEK_VIEW = {
  view: "calendar",
  screen: "calendar",
  calendarViewMode: "week",
  date: "2026-11-21",
  timeZone: "America/Los_Angeles",
};

async function inTab<T>(fn: () => T | Promise<T>): Promise<T> {
  return await runWithRequestContext(
    {
      userEmail: USER_EMAIL,
      run: { browserTabId: TAB_ID },
    },
    fn,
  );
}

describe("Calendar navigate keeps Week view and returns a typed result without intent open", () => {
  beforeEach(async () => {
    await appStateDelete(USER_EMAIL, `navigate:${TAB_ID}`);
    await appStateDelete(USER_EMAIL, "navigate");
    await appStatePut(USER_EMAIL, `navigation:${TAB_ID}`, WEEK_VIEW);
  });

  afterAll(async () => {
    await closeDbExec();
    if (PREVIOUS_DB_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = PREVIOUS_DB_URL;
    }
    rmSync(TEMP_DB_DIR, { recursive: true, force: true });
  });

  it.each(["mcp", "tool", "webmcp", "a2a"] as const)(
    "returns a typed kept-view result (not an error) for %s when navigating to an event without intent open",
    async (caller) => {
      const result = await inTab(() =>
        navigate.run(
          {
            eventId: "ev-1",
            date: "2026-11-21",
            calendarViewMode: "day",
          },
          { caller, actionName: "navigate" },
        ),
      );

      expect(result).toMatchObject({
        kept: true,
        navigated: false,
        reason: "detail-requires-open-intent",
        currentView: WEEK_VIEW,
        message: expect.stringContaining("week"),
      });
      expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();
      expect(await appStateGet(USER_EMAIL, "navigate")).toBeNull();
    },
  );

  it("returns a typed kept-view result even when a standalone navigate observes an internal cache write", async () => {
    const navigateWithCacheWrite = defineAction({
      description: "Navigate after refreshing a local read cache.",
      schema: z.object({
        eventId: z.string(),
        date: z.string().optional(),
        calendarViewMode: z.enum(["day", "week", "month"]).optional(),
      }),
      run: async (args) => {
        noteExternalWrite("db-cache");
        await writeAppStateForCurrentTab("navigate", {
          eventId: args.eventId,
        });
        return { navigated: true, eventId: args.eventId };
      },
    });

    const result = await inTab(() =>
      navigateWithCacheWrite.run(
        { eventId: "ev-1", date: "2026-11-21", calendarViewMode: "day" },
        { caller: "mcp", actionName: "navigate" },
      ),
    );

    expect(result).toMatchObject({
      kept: true,
      navigated: false,
      reason: "detail-requires-open-intent",
      currentView: WEEK_VIEW,
      message: expect.stringContaining('intent: "open"'),
    });
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();
  });

  it("keeps Week view and returns a typed kept-view result when navigate runs inside a write action without intent", async () => {
    const moveEvent = defineAction({
      description: "Move an event and call navigate.",
      schema: z.object({ eventId: z.string() }),
      run: async ({ eventId }, ctx) => {
        const navResult = await navigate.run(
          { calendarViewMode: "day", date: "2026-11-21" },
          { ...ctx, caller: ctx?.caller ?? "mcp", actionName: "navigate" },
        );
        return { moved: eventId, navResult };
      },
    });

    const result = await inTab(() =>
      moveEvent.run(
        { eventId: "ev-1" },
        { caller: "mcp", actionName: "manage-event" },
      ),
    );

    expect(result).toMatchObject({
      moved: "ev-1",
      navResult: {
        kept: true,
        navigated: false,
        reason: "write-keeps-view",
        currentView: WEEK_VIEW,
      },
    });
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();
  });

  it("navigates when intent open is set, and still blocks direct navigate writes from non-navigate writes", async () => {
    await inTab(() =>
      navigate.run(
        {
          eventId: "ev-1",
          date: "2026-11-21",
          calendarViewMode: "day",
          intent: "open",
        },
        { caller: "mcp", actionName: "navigate" },
      ),
    );
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toMatchObject({
      eventId: "ev-1",
      date: "2026-11-21",
      calendarViewMode: "day",
    });

    await appStateDelete(USER_EMAIL, `navigate:${TAB_ID}`);

    const directWriteAction = defineAction({
      description: "Write action trying to move the view directly.",
      schema: z.object({}),
      run: async () => {
        await writeAppStateForCurrentTab("navigate", {
          calendarViewMode: "day",
        });
      },
    });

    await expect(
      inTab(() =>
        directWriteAction.run(
          {},
          { caller: "mcp", actionName: "manage-event" },
        ),
      ),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();
  });
});
