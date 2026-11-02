import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { triageItems } from "../db/schema.js";
import { factoryMigrations } from "../plugins/factory-migrations.js";
import type { WorkflowScope } from "../workflow/adapter.js";
import { createReportReader } from "./report-reader.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const SIGNAL = new AbortController().signal;
const EARLIER = "2026-10-18T09:00:00.000Z";

let sharedClient: PGliteClient | undefined;

async function emptyClient(): Promise<PGliteClient> {
  if (!sharedClient) {
    sharedClient = await PGlite.create("memory://");
    for (const migration of factoryMigrations) {
      if (typeof migration.sql === "string") {
        await sharedClient.exec(migration.sql);
      }
    }
  }
  await sharedClient.exec("TRUNCATE factory_items");
  return sharedClient;
}

afterAll(async () => {
  await sharedClient?.close();
  sharedClient = undefined;
});

let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  db = drizzle(await emptyClient());
});

type RowInput = Partial<typeof triageItems.$inferInsert> & { id: string };

async function insertRow(input: RowInput) {
  await db.insert(triageItems).values({
    source: "slack",
    externalId: input.id,
    title: "Slack user Sam",
    summary: `Summary of ${input.id}.`,
    status: "received",
    coverage: "complete",
    dedupeKey: input.id,
    metadataJson: "{}",
    createdAt: EARLIER,
    updatedAt: EARLIER,
    ownerEmail: "owner@example.test",
    orgId: SCOPE.orgId,
    factoryId: SCOPE.factoryId,
    ...input,
  });
}

const reader = () =>
  createReportReader({ scope: SCOPE, getDatabase: () => db as never });

describe("the reports a Builder task is for, read from the inbox", () => {
  it("reads a Slack report as the engine does: named by its headline, with who wrote it beside", async () => {
    await insertRow({
      id: "r1",
      summary: "The export button downloads an empty file. It worked Monday.",
      sourceUrl: "https://example.slack.com/archives/C1/p1760000000000100",
      channelId: "C1",
      threadTs: "1760000000.000100",
      metadataJson: JSON.stringify({
        messageTs: "1760000000.000100",
        author: "U123",
        headline: "The export button downloads an empty file",
        textTruncated: true,
      }),
    });

    const read = await reader()(["r1"], SIGNAL);

    expect(read).toEqual({
      ok: true,
      reports: [
        expect.objectContaining({
          id: "r1",
          title: "The export button downloads an empty file",
          text: "The export button downloads an empty file. It worked Monday.",
          textTruncated: true,
          url: "https://example.slack.com/archives/C1/p1760000000000100",
          author: "U123",
          thread: { channelId: "C1", threadTs: "1760000000.000100" },
          extras: expect.objectContaining({ authorLabel: "Slack user Sam" }),
        }),
      ],
    });
  });

  it("keeps the author label as the title when the row has no headline, and says nothing of one", async () => {
    await insertRow({
      id: "r1",
      metadataJson: JSON.stringify({ messageTs: "1760000000.000100" }),
    });

    const read = await reader()(["r1"], SIGNAL);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.reports[0]?.title).toBe("Slack user Sam");
    expect(read.reports[0]?.extras).not.toHaveProperty("authorLabel");
  });

  it("returns the reports in the order they were asked for", async () => {
    for (const id of ["r1", "r2", "r3"]) {
      await insertRow({
        id,
        metadataJson: JSON.stringify({ messageTs: "1760000000.000100" }),
      });
    }

    const read = await reader()(["r3", "r1", "r2"], SIGNAL);

    expect(read.ok && read.reports.map((report) => report.id)).toEqual([
      "r3",
      "r1",
      "r2",
    ]);
  });

  it("fails, naming the report, when it is not in this factory's inbox", async () => {
    await insertRow({ id: "r1" });

    const read = await reader()(["r1", "r2"], SIGNAL);

    expect(read).toMatchObject({
      ok: false,
      code: "item_invalid",
      retryable: false,
    });
    expect(!read.ok && read.message).toContain('"r2"');
    expect(!read.ok && read.message).not.toContain('"r1"');
  });

  it("never reads a report of another factory or organization", async () => {
    await insertRow({ id: "other-factory", factoryId: "factory-2" });
    await insertRow({ id: "other-org", orgId: "org-2" });

    const read = await reader()(["other-factory", "other-org"], SIGNAL);

    expect(read).toMatchObject({ ok: false, code: "item_invalid" });
    expect(!read.ok && read.message).toContain('"other-factory"');
    expect(!read.ok && read.message).toContain('"other-org"');
  });

  it("fails, naming the report, when its row cannot be read", async () => {
    await insertRow({ id: "r1", metadataJson: "{not json" });

    const read = await reader()(["r1"], SIGNAL);

    expect(read).toMatchObject({
      ok: false,
      code: "item_invalid",
      retryable: false,
    });
    expect(!read.ok && read.message).toContain('"r1"');
  });

  it("stops when the run has been stopped, without reading", async () => {
    const stopped = new AbortController();
    stopped.abort(new Error("run stopped"));

    await expect(reader()(["r1"], stopped.signal)).rejects.toThrow(
      "run stopped",
    );
  });
});
