import { PGlite } from "@electric-sql/pglite";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import * as schema from "../server/db/schema.js";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("../server/db/index.js", () => ({ getDb: () => state.db, schema }));
vi.mock("@agent-native/core/sharing", async () => {
  const { sql: rawSql } = await import("drizzle-orm");
  return { accessFilter: () => rawSql`true`, resolveAccess: vi.fn() };
});
vi.mock("../server/lib/audiences.js", () => ({
  listAccessibleAudienceIds: async () => ["audience"],
}));
vi.mock("../server/lib/source-access.js", async () => {
  const { sql: rawSql } = await import("drizzle-orm");
  return { personalGoogleSourceFilter: () => rawSql`true` };
});
vi.mock("../server/lib/brain.js", () => ({
  latestDistillationQueuesForCaptures: async () => new Map(),
  sourceUrlFromMetadataRecord: () => null,
}));
vi.mock("../server/lib/search.js", () => ({
  redactSensitiveText: (value: string) => value,
}));
vi.mock("../server/lib/search-index-contracts.js", () => ({
  parseCaptureMetadata: () => null,
  withheldZoomPassageCount: () => 0,
}));
import listCaptures from "./list-captures.js";

const db = new PGlite();
const createTable = (
  table: Parameters<typeof getTableColumns>[0],
  name: string,
) =>
  `CREATE TABLE ${name} (${Object.values(getTableColumns(table))
    .map((column) => `"${column.name}" text`)
    .join(",")})`;

beforeAll(async () => {
  state.db = drizzle(db, { schema });
  await db.exec(createTable(schema.brainSources, "brain_sources"));
  await db.exec(createTable(schema.brainRawCaptures, "brain_raw_captures"));
  await db.exec(
    createTable(schema.brainCaptureAudiences, "brain_capture_audiences"),
  );
  await db.query(
    `INSERT INTO brain_sources (id,title,provider,status) SELECT 'source-'||lpad(n::text,3,'0'),'Source','manual','active' FROM generate_series(1,260) AS n`,
  );
  await db.exec(
    `INSERT INTO brain_raw_captures (id,source_id,title,kind,status,sensitivity_disposition,captured_at) VALUES ('late','source-260','Late capture','note','distilling','allowed','2026-01-01');
     INSERT INTO brain_capture_audiences (capture_id,audience_id) VALUES ('late','audience')`,
  );
});
afterAll(async () => db.close());

it("finds a capture whose source falls outside the broad source cap", async () => {
  const result = await listCaptures.run({
    captureId: "late",
    status: "distilling",
    limit: 1,
    includeArchivedSources: false,
    includePreview: false,
    previewLength: 220,
  });
  expect(result).toMatchObject({ count: 1, captures: [{ id: "late" }] });
});
