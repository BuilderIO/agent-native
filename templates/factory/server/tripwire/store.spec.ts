import { createRequire } from "node:module";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { factoryTripwires } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import {
  TRIPWIRE_KEEP_PER_ORG,
  TRIPWIRE_PRUNE_BATCH,
  createDrizzleTripwireStore,
  type TripwireRow,
  type TripwireStore,
} from "./store.js";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

let client: Awaited<ReturnType<typeof PGlite.create>>;
let db: ReturnType<typeof drizzle>;
let store: TripwireStore;

beforeAll(async () => {
  client = await PGlite.create("memory://");
  for (const migration of factoryMigrations) {
    if (typeof migration.sql === "string") await client.exec(migration.sql);
  }
  db = drizzle(client);
  store = createDrizzleTripwireStore({ getDatabase: () => db });
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec("TRUNCATE factory_tripwires");
});

function row(orgId: string, factoryId: string, index: number): TripwireRow {
  return {
    id: `${orgId}-${factoryId}-${String(index).padStart(5, "0")}`,
    orgId,
    factoryId,
    workflowId: null,
    runId: null,
    nodeId: null,
    area: "agent",
    code: "agent_write_rejected",
    severity: "warn",
    detailsJson: "{}",
    createdAt: new Date(
      Date.parse("2026-10-01T00:00:00.000Z") + index * 1000,
    ).toISOString(),
  };
}

async function seedFactories(orgId: string, factories: number) {
  await db
    .insert(factoryTripwires)
    .values(
      Array.from({ length: factories }, (_, index) =>
        row(orgId, `fake-${index}`, index),
      ),
    );
}

const countOf = async (orgId: string) =>
  (
    await db
      .select({ id: factoryTripwires.id })
      .from(factoryTripwires)
      .where(eq(factoryTripwires.orgId, orgId))
  ).length;

describe("retention across an organization's factories", () => {
  // A member who rotates factory ids never reaches the per-factory cap of 500,
  // so the organization's own cap is what bounds the table.
  it("holds an organization to its newest rows however many factory ids they spread over", async () => {
    const excess = 3 * TRIPWIRE_PRUNE_BATCH - 10;
    const total = TRIPWIRE_KEEP_PER_ORG + excess;
    await seedFactories("org-1", total);
    await seedFactories("org-2", 30);

    const deleted: number[] = [];
    for (let pass = 0; pass < 5; pass += 1) {
      deleted.push(await store.prune({ orgId: "org-1", factoryId: "fake-0" }));
    }

    expect(deleted).toEqual([
      TRIPWIRE_PRUNE_BATCH,
      TRIPWIRE_PRUNE_BATCH,
      excess - 2 * TRIPWIRE_PRUNE_BATCH,
      0,
      0,
    ]);
    expect(await countOf("org-1")).toBe(TRIPWIRE_KEEP_PER_ORG);
    expect(await countOf("org-2")).toBe(30);
    // The oldest go first, so what is kept is the most recent history.
    const [oldestKept] = await db
      .select({ id: factoryTripwires.id })
      .from(factoryTripwires)
      .where(eq(factoryTripwires.orgId, "org-1"))
      .orderBy(factoryTripwires.createdAt)
      .limit(1);
    expect(oldestKept!.id).toBe(
      `org-1-fake-${excess}-${String(excess).padStart(5, "0")}`,
    );
  });

  it("keeps an organization under its cap whole", async () => {
    await seedFactories("org-1", 300);
    expect(await store.prune({ orgId: "org-1", factoryId: "fake-0" })).toBe(0);
    expect(await countOf("org-1")).toBe(300);
  });
});
