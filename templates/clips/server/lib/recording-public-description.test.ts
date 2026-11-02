import { createRequire } from "node:module";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "../db/schema.js";
const state = vi.hoisted(() => ({
  db: null as unknown as PgDatabase<PgQueryResultHKT, typeof schema>,
}));
vi.mock("../db/index.js", async () => ({
  getDb: () => state.db,
  schema: await import("../db/schema.js"),
}));
import {
  loadLegacyDescriptionPublication,
  loadPublicRecordingDescription,
  publicRecordingDescription,
} from "./recording-public-description.js";
const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
let client: Awaited<ReturnType<typeof PGlite.create>>;
beforeAll(async () => {
  client = await PGlite.create("memory://");
  await client.exec(
    "CREATE TABLE recordings(id TEXT PRIMARY KEY,owner_email TEXT,description TEXT,description_source TEXT);INSERT INTO recordings VALUES ('report','owner@example.test','private report description','legacy'),('changed','owner@example.test','user-authored revision','legacy'),('explicit','owner@example.test','published report description','user'),('ordinary','owner@example.test','deliberate video description','legacy');CREATE TABLE recording_bug_reports(recording_id TEXT PRIMARY KEY,description TEXT);INSERT INTO recording_bug_reports VALUES('report','private report description'),('changed','original report description'),('explicit','published report description')",
  );
  state.db = drizzle(client, { schema });
});
afterAll(async () => client.close());
describe("recording description publication", () => {
  it("seals copied legacy report text while preserving explicit publication and edited descriptions", async () => {
    const records = [
      {
        id: "report",
        ownerEmail: "owner@example.test",
        description: "private report description",
        descriptionSource: "legacy",
      },
      {
        id: "changed",
        ownerEmail: "owner@example.test",
        description: "user-authored revision",
        descriptionSource: "legacy",
      },
      {
        id: "explicit",
        ownerEmail: "owner@example.test",
        description: "published report description",
        descriptionSource: "user",
      },
      {
        id: "ordinary",
        ownerEmail: "owner@example.test",
        description: "deliberate video description",
        descriptionSource: "legacy",
      },
      {
        id: "sealed",
        ownerEmail: "owner@example.test",
        description: "sealed report description",
        descriptionSource: "report",
      },
    ];
    const reports = await loadLegacyDescriptionPublication(records);
    expect(
      records.map((record) =>
        publicRecordingDescription(record, reports.get(record.id)),
      ),
    ).toEqual([
      "",
      "user-authored revision",
      "published report description",
      "deliberate video description",
      "",
    ]);
    expect(
      await loadPublicRecordingDescription(
        records[0] ?? { id: "missing", ownerEmail: "owner@example.test" },
      ),
    ).toBe("");
  });
  it("propagates unreadable provenance instead of exposing legacy text", async () => {
    await client.exec("DROP TABLE recording_bug_reports");
    await expect(
      loadPublicRecordingDescription({
        id: "report",
        ownerEmail: "owner@example.test",
        description: "private report description",
        descriptionSource: "legacy",
      }),
    ).rejects.toThrow();
    expect(
      await loadPublicRecordingDescription({
        id: "explicit",
        ownerEmail: "owner@example.test",
        description: "deliberately published",
        descriptionSource: "user",
      }),
    ).toBe("deliberately published");
  });
});
