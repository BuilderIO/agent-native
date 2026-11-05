import { defineAction, fail } from "@agent-native/core/action";
import { closeDbExec, type DbExec } from "@agent-native/core/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { snapshotDesignBeforeAgentEdit } from "./design-versions.js";
import {
  agentToolContext,
  bootDesignDatabase,
  countRows,
  runCall,
  seedDesign,
} from "./failed-write-test-harness.js";

// The checkpoint a Design action takes before it edits is bookkeeping: the
// agent that retries a rejected call finds the same version, not a second one.
// A real database sits behind both the checkpoint and the action's own write,
// so each statement is observed the way a production one is.
let exec: DbExec;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  exec = await bootDesignDatabase();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

const files = [{ filename: "index.html", content: "<main>One</main>" }];

function probe(
  run: (
    designId: string,
    ctx: Parameters<typeof snapshotDesignBeforeAgentEdit>[1],
  ) => Promise<unknown>,
) {
  return defineAction({
    description: "Snapshots a design, then runs the probe step.",
    schema: z.object({ designId: z.string() }),
    run: async ({ designId }, ctx) => run(designId, ctx),
  });
}

describe("a Design action that checkpoints and then fails", () => {
  it("is none when it rejects the request after the checkpoint", async () => {
    await seedDesign(exec, "design-reject", files);
    const action = probe(async (designId, ctx) => {
      await snapshotDesignBeforeAgentEdit(designId, ctx);
      fail("The edit does not match the file.");
    });

    const { effect, outcome } = await runCall(
      action,
      { designId: "design-reject" },
      agentToolContext("probe-action"),
    );

    expect(await countRows(exec, "design_versions", "design-reject")).toBe(1);
    expect(effect).toMatchObject({ effect: "none" });
    expect(outcome.evidence?.writeObserved).toBe(false);
  });

  it("is unknown when the action's own data write ran before it failed", async () => {
    await seedDesign(exec, "design-wrote", files);
    const action = probe(async (designId, ctx) => {
      await snapshotDesignBeforeAgentEdit(designId, ctx);
      await getDb()
        .update(schema.designs)
        .set({ title: "Renamed" })
        .where(eq(schema.designs.id, designId));
      fail("Failed after the rename.");
    });

    const { effect, outcome } = await runCall(
      action,
      { designId: "design-wrote" },
      agentToolContext("probe-action"),
    );

    expect(effect).toEqual({ effect: "unknown", changed: true });
    expect(outcome.evidence).toMatchObject({
      writeObserved: true,
      writeObservedChannel: "db",
    });
  });

  it("is unknown when a write that is not a checkpoint came first", async () => {
    await seedDesign(exec, "design-write-first", files);
    const action = probe(async (designId, ctx) => {
      await getDb()
        .update(schema.designs)
        .set({ title: "Renamed first" })
        .where(eq(schema.designs.id, designId));
      await snapshotDesignBeforeAgentEdit(designId, ctx);
      fail("Failed after both.");
    });

    const { effect } = await runCall(
      action,
      { designId: "design-write-first" },
      agentToolContext("probe-action"),
    );

    expect(effect).toMatchObject({ effect: "unknown" });
  });
});

describe("a retried checkpoint cannot add a second version", () => {
  const checkpoint = (designId: string, turnId: string) =>
    runCall(
      probe(async (id, ctx) => snapshotDesignBeforeAgentEdit(id, ctx)),
      { designId },
      agentToolContext("probe-action", turnId),
    );

  const retitle = (designId: string) =>
    exec.execute({
      sql: "UPDATE designs SET title = ? WHERE id = ?",
      args: ["Retitled", designId],
    });

  it("finds the turn's own version again", async () => {
    await seedDesign(exec, "design-retry", files);

    const first = await checkpoint("design-retry", "turn-a");
    const second = await checkpoint("design-retry", "turn-a");

    expect(second.result).toEqual(first.result);
    expect(await countRows(exec, "design_versions", "design-retry")).toBe(1);
  });

  it("finds it again after the design changed under the turn", async () => {
    await seedDesign(exec, "design-retry-changed", files);

    const first = await checkpoint("design-retry-changed", "turn-a");
    await retitle("design-retry-changed");
    const second = await checkpoint("design-retry-changed", "turn-a");

    expect(second.result).toEqual(first.result);
    expect(
      await countRows(exec, "design_versions", "design-retry-changed"),
    ).toBe(1);
  });

  it("still takes one version for each new turn", async () => {
    await seedDesign(exec, "design-turns", files);

    await checkpoint("design-turns", "turn-a");
    await retitle("design-turns");
    await checkpoint("design-turns", "turn-b");

    expect(await countRows(exec, "design_versions", "design-turns")).toBe(2);
  });
});
