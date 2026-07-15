import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializeContentSourceDocument } from "../shared/content-source.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `import-content-source-test-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let importContentSourceAction: typeof import("./import-content-source.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  importContentSourceAction = (await import("./import-content-source.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

function sourceWithDescription(description: string) {
  return serializeContentSourceDocument({
    id: "doc_description_roundtrip",
    parentId: null,
    title: "Description round-trip",
    description,
    content: "Body",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
  });
}

describe("import-content-source descriptions", () => {
  it("persists exported descriptions when creating and updating documents", async () => {
    const path =
      "content/description-round-trip--doc_description_roundtrip.mdx";

    const created = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: sourceWithDescription("Initial stable guidance") },
        dryRun: false,
      }),
    );

    expect(created.created).toEqual([
      expect.objectContaining({ id: "doc_description_roundtrip", path }),
    ]);
    await expect(
      getDb()
        .select({ description: schema.documents.description })
        .from(schema.documents)
        .where(eq(schema.documents.id, "doc_description_roundtrip")),
    ).resolves.toEqual([{ description: "Initial stable guidance" }]);

    const updated = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: sourceWithDescription("Revised stable guidance") },
        dryRun: false,
      }),
    );

    expect(updated.updated).toEqual([
      expect.objectContaining({ id: "doc_description_roundtrip", path }),
    ]);
    await expect(
      getDb()
        .select({ description: schema.documents.description })
        .from(schema.documents)
        .where(eq(schema.documents.id, "doc_description_roundtrip")),
    ).resolves.toEqual([{ description: "Revised stable guidance" }]);

    const unchanged = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: sourceWithDescription("Revised stable guidance") },
        dryRun: false,
      }),
    );

    expect(unchanged.unchanged).toEqual([
      expect.objectContaining({ id: "doc_description_roundtrip", path }),
    ]);
  });
});
