import {
  invocationEffect,
  runActionWithExecutionOutcome,
  type ActionExecutionOutcome,
  type ActionRunContext,
  type InvocationEffect,
} from "@agent-native/core/action";
import {
  getDbExec,
  withMigrationRuntime,
  type DbExec,
} from "@agent-native/core/db";
import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";

import { runDesignMigrations } from "../plugins/db.js";

export const DESIGN_OWNER = "owner@example.com";

type Run = Parameters<typeof runActionWithExecutionOutcome>[0];
type Runnable = {
  run: (args: never, ctx?: ActionRunContext) => unknown;
  changeEvents?: boolean;
};

/** A call the agent loop makes: the thread and turn name the call's chat. */
export function agentToolContext(
  actionName: string,
  turnId = "turn-1",
): ActionRunContext {
  return {
    caller: "tool",
    actionName,
    threadId: "thread-1",
    runId: "run-1",
    turnId,
  };
}

/**
 * A real in-memory Design database with every migration applied. The caller
 * stubs `DATABASE_URL` and the Design database URLs to `pglite:memory://`
 * first, so each statement reaches the framework's write observation the way
 * a production statement does.
 */
export async function bootDesignDatabase(): Promise<DbExec> {
  registerLabs([CREATIVE_CONTEXT_LIBRARY_LAB]);
  await withMigrationRuntime(async () => {
    await runDesignMigrations({});
  });
  return getDbExec();
}

/** Seeds one design and its screens; each screen's id is `${designId}:${filename}`. */
export async function seedDesign(
  exec: DbExec,
  designId: string,
  files: ReadonlyArray<{ filename: string; content: string }> = [],
): Promise<void> {
  await exec.execute({
    sql: "INSERT INTO designs (id, title, data, owner_email, visibility) VALUES (?, ?, ?, ?, ?)",
    args: [designId, "Probe design", "{}", DESIGN_OWNER, "private"],
  });
  for (const file of files) {
    await exec.execute({
      sql: "INSERT INTO design_files (id, design_id, filename, file_type, content) VALUES (?, ?, ?, ?, ?)",
      args: [
        `${designId}:${file.filename}`,
        designId,
        file.filename,
        "html",
        file.content,
      ],
    });
  }
}

export async function countRows(
  exec: DbExec,
  table: "design_versions" | "design_files",
  designId: string,
): Promise<number> {
  const { rows } =
    table === "design_versions"
      ? await exec.execute({
          sql: "SELECT COUNT(*) AS n FROM design_versions WHERE design_id = ?",
          args: [designId],
        })
      : await exec.execute({
          sql: "SELECT COUNT(*) AS n FROM design_files WHERE design_id = ?",
          args: [designId],
        });
  return Number(rows[0]?.n);
}

/** Runs `entry` as a dispatcher does, as the design's owner, and reads what it did. */
export async function runCall(
  entry: Runnable,
  args: unknown,
  ctx: ActionRunContext,
): Promise<{
  outcome: ActionExecutionOutcome;
  error?: unknown;
  result?: unknown;
  effect: InvocationEffect;
}> {
  const outcome: ActionExecutionOutcome = { refused: false };
  const settled = await runWithRequestContext({ userEmail: DESIGN_OWNER }, () =>
    runActionWithExecutionOutcome(entry.run as Run, args, ctx, outcome, entry),
  ).then(
    (result: unknown) => ({ result }),
    (error: unknown) => ({ error }),
  );
  const failed = "error" in settled ? { error: settled.error } : undefined;
  return {
    outcome,
    ...settled,
    effect: invocationEffect(entry, outcome, failed ? { failed } : {}),
  };
}
