import { runWithRequestContext } from "@agent-native/core/server";
import { beforeAll, describe, expect, it } from "vitest";

let dbModule: typeof import("../server/db/index.js");
let action: typeof import("./get-document-sidebar-commands.js").default;
const owner = "sidebar-owner@example.com";
const viewer = "sidebar-viewer@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = "pglite:memory";
  dbModule = await import("../server/db/index.js");
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  action = (await import("./get-document-sidebar-commands.js")).default;
}, 60000);

async function page(
  id: string,
  values: Partial<typeof dbModule.schema.documents.$inferInsert> = {},
) {
  await dbModule
    .getDb()
    .insert(dbModule.schema.documents)
    .values({
      id,
      title: id,
      ownerEmail: owner,
      content: "",
      visibility: "private",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...values,
    });
}

function commands(documentId: string, userEmail = owner) {
  return runWithRequestContext({ userEmail }, () =>
    action.run({ documentId, includeDestinations: true }),
  );
}

describe("sidebar command destinations", () => {
  it("offers only authorized same-space native Pages outside containment descendants", async () => {
    await page("move-source", { spaceId: "space-one" });
    await page("move-target", { spaceId: "space-one" });
    await page("other-space", { spaceId: "space-two" });
    await page("child", { spaceId: "space-one", parentId: "move-source" });
    await page("grandchild", { spaceId: "space-one", parentId: "child" });
    await page("source-file", {
      spaceId: "space-one",
      sourceMode: "local-files",
      sourcePath: "note.md",
    });
    await page("trashed", {
      spaceId: "space-one",
      trashedAt: new Date().toISOString(),
    });
    await page("different-owner", { spaceId: "space-one", ownerEmail: viewer });
    const result = await commands("move-source");
    expect(result.writeReason).toBeNull();
    expect(result.destinations.map((item) => item.id)).toEqual(["move-target"]);
    expect(result.canMoveToRoot).toBe(false);
  });

  it("denies an inaccessible target before exposing its title or destinations", async () => {
    await expect(commands("move-source", viewer)).rejects.toThrow();
  });

  it("keeps viewer commands read-only and returns no destination metadata", async () => {
    await page("public-read", { visibility: "public" });
    const result = await commands("public-read", viewer);
    expect(result.writeReason).toBe("readOnly");
    expect(result.destinations).toEqual([]);
    expect(result.canMoveToRoot).toBe(false);
  });

  it("explains unsupported Source commands without offering a mutation destination", async () => {
    const result = await commands("source-file");
    expect(result.writeReason).toBe("sourceUnsupported");
    expect(result.destinations).toEqual([]);
  });
});
