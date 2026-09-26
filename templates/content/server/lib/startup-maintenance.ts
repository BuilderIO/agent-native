import { ensureAdditiveColumns, getDbExec } from "@agent-native/core/db";

import { repairFilesSystemPropertyDefinitions } from "../../actions/_files-system-properties.js";
import { repairUnseededBlocksFields } from "../../actions/_property-utils.js";
import * as schema from "../db/schema.js";


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
    throw new Error(
      `ensureAdditiveColumns reported ${summary.errors.length} error(s): ${summary.errors.map((e) => `${e.column}: ${e.error}`).join("; ")}`,
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

async function scheduleRetry(
  label: string,
  attempt: number,
  run: () => Promise<void>,
): Promise<void> {
  const delayMs = retryDelayMs(attempt);
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      void runMaintenanceStep(label, attempt + 1, run).finally(resolve);
    }, delayMs);
    if (typeof timeout === "object" && "unref" in timeout) {
      timeout.unref();
    }
  });
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
      await scheduleRetry(label, attempt, run);
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
  await runMaintenanceStep("additive-columns", 1, runAdditiveColumnsCheck);
  await runMaintenanceStep("blocks-repair", 1, runBlocksRepair);
  await runMaintenanceStep(
    "files-system-properties-repair",
    1,
    runFilesSystemPropertyRepair,
  );
}

export function scheduleStartupMaintenance(): Promise<void> {
  if (!maintenanceGlobal.__contentStartupMaintenance) {
    maintenanceGlobal.__contentStartupMaintenance = new Promise<void>(
      (resolve) => {
        setTimeout(() => {
          void runStartupMaintenance().finally(resolve);
        }, 0);
      },
    );
  }
  return maintenanceGlobal.__contentStartupMaintenance;
}
