import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-document-visibility-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "visibility-owner@example.com";
const PARENT_ID = "visibility-parent";
const PRIVATE_CHILD_ID = "visibility-private-child";
const GRANDCHILD_ID = "visibility-private-grandchild";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let setResourceVisibility: { run: (args: any) => Promise<any> };

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  setResourceVisibility = (
    await import("@agent-native/core/sharing/actions/set-resource-visibility")
  ).default as { run: (args: any) => Promise<any> };
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values([
      {
        id: PARENT_ID,
        ownerEmail: OWNER,
        orgId: null,
        parentId: null,
        title: "Parent",
        content: "",
        position: 0,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PRIVATE_CHILD_ID,
        ownerEmail: OWNER,
        orgId: null,
        parentId: PARENT_ID,
        title: "Private child",
        content: "",
        position: 0,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: GRANDCHILD_ID,
        ownerEmail: OWNER,
        orgId: null,
        parentId: PRIVATE_CHILD_ID,
        title: "Private grandchild",
        content: "",
        position: 0,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
    ]);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

async function visibilityOf(id: string) {
  const [row] = await getDb()
    .select({ visibility: schema.documents.visibility })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row?.visibility;
}

describe("document visibility does not cascade", () => {
  it("making a parent public leaves an explicitly private child and grandchild untouched", async () => {
    await runWithRequestContext({ userEmail: OWNER }, () =>
      setResourceVisibility.run({
        resourceType: "document",
        resourceId: PARENT_ID,
        visibility: "public",
      }),
    );

    expect(await visibilityOf(PARENT_ID)).toBe("public");
    expect(await visibilityOf(PRIVATE_CHILD_ID)).toBe("private");
    expect(await visibilityOf(GRANDCHILD_ID)).toBe("private");
  });
});
