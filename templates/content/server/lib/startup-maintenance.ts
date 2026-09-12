import { ensureAdditiveColumns, getDbExec } from "@agent-native/core/db";

import { repairFilesSystemPropertyDefinitions } from "../../actions/_files-system-properties.js";
import { repairUnseededBlocksFields } from "../../actions/_property-utils.js";
import * as schema from "../db/schema.js";

/**
 * The additive-column safety net and the one-time data repairs, moved out of
 * the awaited boot path.
 *
 * Boot used to await all of this inside the db plugin, so every cold start —
 * including steady-state boots where migrations apply nothing and the repairs
 * are no-ops — paid these queries before serving a first request. They now run
 * once per isolate, scheduled just after boot completes, and each step retries
 * with backoff on failure. A failure is never swallowed: every attempt logs
 * loudly, and a step that exhausts its retries says so by name.
 *
 * Ordering matters: the additive-column net runs first (after the awaited
 * hand-written migrations in server/plugins/db.ts), then the repairs — a
 * repair's SELECT can reference a column only the net would add.
 */

/**
 * Every Drizzle table exported from schema.ts. Filters out type-only and
 * helper exports the same way db.spec.ts's `isDrizzleTable` regression guard
 * does: a real table carries a Symbol-keyed drizzle metadata bag, plain
 * exports don't.
 */
function isDrizzleTable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((s) =>
      s.toString().includes("drizzle"),
    )
  );
}

const schemaTables = Object.values(schema).filter(isDrizzleTable);

/**
 * Belt-and-braces safety net for a schema.ts column that shipped without a
 * matching hand-written ALTER migration, which silently 500s every query
 * touching a pre-existing production table. It only ever adds missing columns
 * — never drops, renames, or retypes anything.
 */
async function runAdditiveColumnsCheck(): Promise<void> {
  const summary = await ensureAdditiveColumns({
    db: getDbExec(),
    tables: schemaTables,
  });
  if (summary.errors.length > 0) {
    console.warn(
      "[db] ensureAdditiveColumns completed with errors:",
      summary.errors,
    );
  }
}

async function runBlocksRepair(): Promise<void> {
  await repairUnseededBlocksFields();
}

async function runFilesSystemPropertyRepair(): Promise<void> {
  await repairFilesSystemPropertyDefinitions();
}

const MAX_ATTEMPTS = 5;

function retryDelayMs(attempt: number): number {
  return Math.min(2_000 * attempt, 30_000);
}

function scheduleRetry(
  label: string,
  attempt: number,
  run: () => Promise<void>,
): void {
  const delayMs = retryDelayMs(attempt);
  const timeout = setTimeout(() => {
    void runMaintenanceStep(label, attempt + 1, run);
  }, delayMs);
  if (typeof timeout === "object" && "unref" in timeout) {
    timeout.unref();
  }
}

async function runMaintenanceStep(
  label: string,
  attempt: number,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[db] startup maintenance "${label}" failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${message}`,
    );
    if (attempt < MAX_ATTEMPTS) {
      scheduleRetry(label, attempt, run);
    } else {
      console.error(
        `[db] startup maintenance "${label}" did not complete after ${MAX_ATTEMPTS} attempts; it will run again on the next boot.`,
      );
    }
  }
}

type StartupMaintenanceGlobal = typeof globalThis & {
  __contentStartupMaintenance?: Promise<void>;
};

const maintenanceGlobal = globalThis as StartupMaintenanceGlobal;

async function runStartupMaintenance(): Promise<void> {
  // Sequential on purpose: the safety net may add columns a repair's query
  // touches, and each step retries independently on failure.
  await runMaintenanceStep("additive-columns", 1, runAdditiveColumnsCheck);
  await runMaintenanceStep("blocks-repair", 1, runBlocksRepair);
  await runMaintenanceStep(
    "files-system-properties-repair",
    1,
    runFilesSystemPropertyRepair,
  );
}

/**
 * Kick off the post-boot maintenance once per isolate. Boot does not await
 * this: the work starts on the next tick so it never sits on the critical
 * path between module init and the first response, and concurrent callers
 * join the same in-flight run.
 */
export function scheduleStartupMaintenance(): Promise<void> {
  if (!maintenanceGlobal.__contentStartupMaintenance) {
    maintenanceGlobal.__contentStartupMaintenance = new Promise<void>(
      (resolve) => {
        const timeout = setTimeout(() => {
          void runStartupMaintenance().finally(resolve);
        }, 0);
        if (typeof timeout === "object" && "unref" in timeout) {
          timeout.unref();
        }
      },
    );
  }
  return maintenanceGlobal.__contentStartupMaintenance;
}
