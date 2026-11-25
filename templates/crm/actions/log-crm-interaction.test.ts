import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-log-interaction-test-${process.pid}-${Date.now()}.pglite`,
);

const OWNER = "owner@example.test";
const OTHER = "other@example.test";
const CONNECTION_ID = "conn_log_interaction";

type Schema = typeof import("../server/db/schema.js");
let getDb: (typeof import("../server/db/index.js"))["getDb"];
let schema: Schema;
let logCrmInteraction: (typeof import("./log-crm-interaction.js"))["default"];

const ownership = {
  ownerEmail: OWNER,
  orgId: null,
  visibility: "private" as const,
};
const ownerCtx = { caller: "mcp" as const, userEmail: OWNER, orgId: null };
const otherCtx = { caller: "mcp" as const, userEmail: OTHER, orgId: null };

const asOwner = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OWNER }, fn) as Promise<T>;
const asOther = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OTHER }, fn) as Promise<T>;

let counter = 0;
async function createRecord(): Promise<string> {
  const id = `rec_log_${++counter}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmRecords)
    .values({
      id,
      connectionId: CONNECTION_ID,
      provider: "native",
      objectType: "companies",
      kind: "account",
      remoteId: id,
      displayName: "Acme",
      accessScopeKey: "native",
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

async function lastInteractionAt(recordId: string) {
  const rows = await getDb()
    .select({ at: schema.crmRecords.lastMeaningfulInteractionAt })
    .from(schema.crmRecords)
    .where(eq(schema.crmRecords.id, recordId));
  return rows[0].at as string | null;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  logCrmInteraction = (await import("./log-crm-interaction.js")).default;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.crmConnections)
    .values({
      id: CONNECTION_ID,
      provider: "native",
      label: "Native SQL",
      mode: "native",
      status: "connected",
      accessScopeKey: "native",
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("log-crm-interaction", () => {
  it("inserts an interaction and advances lastMeaningfulInteractionAt", async () => {
    const recordId = await createRecord();
    const result = await asOwner(() =>
      logCrmInteraction.run(
        {
          recordId,
          kind: "call",
          direction: "outbound",
          summary: "Discussed renewal pricing.",
          occurredAt: "2026-07-01T10:00:00.000Z",
        },
        ownerCtx,
      ),
    );
    const rows = await getDb()
      .select()
      .from(schema.crmInteractions)
      .where(eq(schema.crmInteractions.recordId, recordId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.interactionId,
      kind: "call",
      direction: "outbound",
      summary: "Discussed renewal pricing.",
      occurredAt: "2026-07-01T10:00:00.000Z",
      ownerEmail: OWNER,
    });
    expect(await lastInteractionAt(recordId)).toBe("2026-07-01T10:00:00.000Z");
  });

  it("never moves lastMeaningfulInteractionAt backwards", async () => {
    const recordId = await createRecord();
    const log = (occurredAt: string) =>
      asOwner(() =>
        logCrmInteraction.run(
          { recordId, kind: "email", summary: "x", occurredAt },
          ownerCtx,
        ),
      );
    await log("2026-07-05T00:00:00.000Z");
    await log("2026-07-01T00:00:00.000Z");
    expect(await lastInteractionAt(recordId)).toBe("2026-07-05T00:00:00.000Z");
  });

  it("leaves the timestamp alone for non-meaningful entries", async () => {
    const recordId = await createRecord();
    await asOwner(() =>
      logCrmInteraction.run(
        {
          recordId,
          kind: "note",
          summary: "internal",
          meaningful: false,
          occurredAt: "2026-07-01T00:00:00.000Z",
        },
        ownerCtx,
      ),
    );
    expect(await lastInteractionAt(recordId)).toBeNull();
  });

  it("refuses callers without editor access to the record", async () => {
    const recordId = await createRecord();
    await expect(
      asOther(() =>
        logCrmInteraction.run(
          { recordId, kind: "call", summary: "x" },
          otherCtx,
        ),
      ),
    ).rejects.toThrow();
    const rows = await getDb()
      .select()
      .from(schema.crmInteractions)
      .where(eq(schema.crmInteractions.recordId, recordId));
    expect(rows).toHaveLength(0);
  });
});
