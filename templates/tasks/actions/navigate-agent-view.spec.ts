import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineAction } from "@agent-native/core/action";
import {
  AgentNavigationRefusedError,
  appStateDelete,
  appStateGet,
} from "@agent-native/core/application-state";
import { createNavigateAction } from "@agent-native/core/command-navigation";
import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import navigate from "./navigate.js";

const USER_EMAIL = "person@example.com";
const TAB_ID = "tasks-tab-1";
const TEMP_DB_DIR = mkdtempSync(join(tmpdir(), "tasks-navigate-keepview-"));
const PREVIOUS_DB_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = `pglite:${TEMP_DB_DIR}`;

async function inTab<T>(fn: () => T | Promise<T>): Promise<T> {
  return await runWithRequestContext(
    {
      userEmail: USER_EMAIL,
      run: { browserTabId: TAB_ID },
    },
    fn,
  );
}

describe("Tasks navigate keeps the user's view for MCP callers by default", () => {
  beforeEach(async () => {
    await appStateDelete(USER_EMAIL, `navigate:${TAB_ID}`);
    await appStateDelete(USER_EMAIL, "navigate");
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

  it("refuses opening a task from an MCP caller during an edit when no open intent is passed", async () => {
    const editTask = defineAction({
      description: "Edit a task and call the template navigate action.",
      schema: z.object({ taskId: z.string() }),
      run: async ({ taskId }, ctx) => {
        await navigate.run({ view: "tasks", taskId }, ctx);
        return { ok: true };
      },
    });

    await expect(
      inTab(() => editTask.run({ taskId: "task-42" }, { caller: "mcp" })),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);

    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();
    expect(await appStateGet(USER_EMAIL, "navigate")).toBeNull();
  });

  it("refuses even a list-view navigate during an MCP edit without open intent", async () => {
    const editTask = defineAction({
      description: "Edit a task and switch views without intent.",
      schema: z.object({}),
      run: async (_args, ctx) => {
        await navigate.run({ view: "tasks" }, ctx);
      },
    });

    await expect(
      inTab(() => editTask.run({}, { caller: "mcp" })),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);

    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();
  });

  it("keeps the current view and returns a typed result for a standalone detail open without intent, and allows it with intent open", async () => {
    const kept = await inTab(() =>
      navigate.run(
        { view: "tasks", taskId: "task-42" },
        { caller: "mcp", actionName: "navigate" },
      ),
    );
    expect(kept).toMatchObject({
      kept: true,
      navigated: false,
      reason: "detail-requires-open-intent",
      message: expect.stringContaining('intent: "open"'),
    });
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();

    await inTab(() =>
      navigate.run(
        { view: "tasks", taskId: "task-42", intent: "open" },
        { caller: "mcp", actionName: "navigate" },
      ),
    );
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toMatchObject({
      view: "tasks",
      taskId: "task-42",
    });
  });

  it("default createNavigateAction() keeps view and returns a typed result for MCP detail opens without intent open", async () => {
    const defaultNavigate = createNavigateAction();

    const kept = await inTab(() =>
      defaultNavigate.run({ path: "/items/123" }, { caller: "mcp" }),
    );
    expect(kept).toMatchObject({
      kept: true,
      navigated: false,
      reason: "detail-requires-open-intent",
      message: expect.stringContaining('intent: "open"'),
    });
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toBeNull();

    await inTab(() =>
      defaultNavigate.run(
        { path: "/items/123", intent: "open" },
        { caller: "mcp" },
      ),
    );
    expect(await appStateGet(USER_EMAIL, `navigate:${TAB_ID}`)).toMatchObject({
      path: "/items/123",
    });
  });
});
