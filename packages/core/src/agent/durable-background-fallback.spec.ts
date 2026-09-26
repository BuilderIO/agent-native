import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";


const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const { insertRun, claimBackgroundRun, getRunById, updateRunStatusIfRunning } =
  await import("./run-store.js");

let seq = 0;
function nextRunId(): string {
  seq += 1;
  return `run-fallback-${seq}`;
}

async function dispatchModeOf(runId: string): Promise<string | null> {
  const row = (await pglite
    .prepare(`SELECT dispatch_mode FROM agent_runs WHERE id = ?`)
    .get(runId)) as { dispatch_mode: string | null } | undefined;
  return row?.dispatch_mode ?? null;
}

describe("durable-background inline fallback — claimBackgroundRun exclusivity", () => {
  it("a single claimer wins on a freshly-inserted background row", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-1", runId, { dispatchMode: "background" });

    expect(await claimBackgroundRun(runId)).toBe(true);

    await expect(dispatchModeOf(runId)).resolves.toBe("background-processing");
    expect((await getRunById(runId))?.status).toBe("running");
  });

  it("only ONE of two concurrent claimers wins (inline fallback vs delayed delivery)", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-2", runId, { dispatchMode: "background" });

    const [a, b] = await Promise.all([
      claimBackgroundRun(runId),
      claimBackgroundRun(runId),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("a second claim after the first loses — the delayed delivery no-ops", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-3", runId, { dispatchMode: "background" });

    expect(await claimBackgroundRun(runId)).toBe(true);
    expect(await claimBackgroundRun(runId)).toBe(false);
  });

  it("cannot be claimed once the run is terminal (errored/reaped)", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-4", runId, { dispatchMode: "background" });

    await updateRunStatusIfRunning(runId, "errored");
    expect(await claimBackgroundRun(runId)).toBe(false);

    const row = await getRunById(runId);
    expect(row?.status).toBe("errored");
  });

  it("does NOT match a normal foreground (non-background) run", async () => {
    const runId = nextRunId();
    await insertRun(runId, "thread-5", runId);
    expect(await claimBackgroundRun(runId)).toBe(false);
  });
});
