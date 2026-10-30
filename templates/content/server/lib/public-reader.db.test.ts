import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeIconValue } from "@agent-native/core/icons";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-public-reader-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "reader-owner@example.test";

let db: ReturnType<typeof import("../db/index.js").getDb>;
let schema: typeof import("../db/schema.js");
let reader: typeof import("./public-reader.js");
let count = 0;

async function page(
  options: {
    title?: string;
    parentId?: string | null;
    visibility?: "private" | "public" | "org";
    icon?: string | null;
    position?: number;
    trashedAt?: string;
    content?: string;
    ownerEmail?: string;
  } = {},
) {
  const id = `public-reader-doc-${++count}`;
  await db.insert(schema.documents).values({
    id,
    ownerEmail: options.ownerEmail ?? OWNER,
    orgId: null,
    parentId: options.parentId ?? null,
    title: options.title ?? `Page ${count}`,
    content: options.content ?? "",
    icon: options.icon ?? null,
    position: options.position ?? 0,
    visibility: options.visibility ?? "public",
    trashedAt: options.trashedAt ?? null,
  });
  return id;
}

async function contextFor(id: string) {
  const rows = await db
    .select({
      id: schema.documents.id,
      parentId: schema.documents.parentId,
      icon: schema.documents.icon,
      content: schema.documents.content,
      ownerEmail: schema.documents.ownerEmail,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  if (rows.length !== 1) throw new Error(`No page ${id}`);
  return reader.loadPublicReaderContext(rows[0]);
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const module = await import("../db/index.js");
  db = module.getDb();
  schema = module.schema;
  reader = await import("./public-reader.js");
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => rmSync(TEST_DB_PATH, { recursive: true, force: true }));

describe("public reader context", () => {
  it("lists the public pages above a page, root first", async () => {
    const root = await page({ title: "Handbook", icon: "🌱" });
    const section = await page({ title: "Tools", parentId: root });
    const leaf = await page({ title: "Repair log", parentId: section });

    const context = await contextFor(leaf);

    expect(context.ancestors).toEqual([
      {
        id: root,
        title: "Handbook",
        icon: { version: 1, kind: "emoji", emoji: "🌱" },
      },
      { id: section, title: "Tools", icon: null },
    ]);
  });

  it("stops the path at a private page and says nothing about it", async () => {
    const hiddenRoot = await page({ title: "Hidden root" });
    const privateParent = await page({
      title: "Private notes",
      parentId: hiddenRoot,
      visibility: "private",
    });
    const leaf = await page({ parentId: privateParent });

    const context = await contextFor(leaf);

    expect(context.ancestors).toEqual([]);
    expect(JSON.stringify(context)).not.toContain("Private notes");
    expect(JSON.stringify(context)).not.toContain("Hidden root");
  });

  it("stops the path at a page in the trash or shared only in a workspace", async () => {
    const trashed = await page({ trashedAt: new Date().toISOString() });
    const underTrashed = await page({ parentId: trashed });
    const orgOnly = await page({ visibility: "org" });
    const underOrgOnly = await page({ parentId: orgOnly });

    expect((await contextFor(underTrashed)).ancestors).toEqual([]);
    expect((await contextFor(underOrgOnly)).ancestors).toEqual([]);
  });

  it("lists only public sub-pages that are not in the trash, in sidebar order", async () => {
    const parent = await page({ title: "Garden" });
    const second = await page({
      title: "Tools",
      parentId: parent,
      position: 2,
    });
    const first = await page({ title: "Plots", parentId: parent, position: 1 });
    await page({
      title: "Board minutes",
      parentId: parent,
      visibility: "private",
    });
    await page({ title: "Staff only", parentId: parent, visibility: "org" });
    await page({
      title: "Old rota",
      parentId: parent,
      trashedAt: new Date().toISOString(),
    });

    const context = await contextFor(parent);

    expect(context.subPages.map((subPage) => subPage.id)).toEqual([
      first,
      second,
    ]);
    const serialized = JSON.stringify(context);
    for (const hidden of ["Board minutes", "Staff only", "Old rota"]) {
      expect(serialized).not.toContain(hidden);
    }
  });

  it("opens the body's page blocks at public pages and lists each sub-page once", async () => {
    const parent = await page({ title: "Garden" });
    const inBody = await page({ title: "Plots", parentId: parent });
    const nested = await page({ title: "Compost", parentId: parent });
    const listed = await page({ title: "Tools", parentId: parent });
    const elsewhere = await page({ title: "Recipes" });
    const hidden = await page({
      title: "Board minutes",
      visibility: "private",
    });
    const trashed = await page({ trashedAt: new Date().toISOString() });
    await db
      .update(schema.documents)
      .set({
        content: [
          "Intro",
          `<page id="${inBody}">Untitled</page>`,
          "<details>",
          "<summary>More</summary>",
          `\t<page id="${nested}">Compost</page>`,
          "</details>",
          `<page id="${elsewhere}">Recipes</page>`,
          `<page id="${hidden}">Minutes</page>`,
          `<page id="${trashed}">Gone</page>`,
        ].join("\n"),
      })
      .where(eq(schema.documents.id, parent));

    const context = await contextFor(parent);

    expect(context.pageLinks).toEqual({
      [inBody]: { id: inBody, title: "Plots", icon: null },
      [nested]: { id: nested, title: "Compost", icon: null },
      [elsewhere]: { id: elsewhere, title: "Recipes", icon: null },
    });
    expect(context.subPages.map((subPage) => subPage.id)).toEqual([listed]);
    expect(JSON.stringify(context)).not.toContain("Board minutes");
  });

  it("opens a Notion page link at the same owner's public import of it", async () => {
    const notionPage = "0123456789abcdef0123456789abcdef";
    const own = await page({ title: "Imported" });
    const someoneElses = await page({
      title: "Their import",
      ownerEmail: "someone-else@example.test",
    });
    await db.insert(schema.documentSyncLinks).values([
      {
        documentId: own,
        ownerEmail: OWNER,
        remotePageId: "01234567-89ab-cdef-0123-456789abcdef",
      },
      {
        documentId: someoneElses,
        ownerEmail: "someone-else@example.test",
        remotePageId: notionPage,
      },
    ]);
    const parent = await page({
      content: `<page url="https://www.notion.so/Imported-${notionPage}">Imported</page>`,
    });

    const context = await contextFor(parent);

    expect(context.pageLinks).toEqual({
      [notionPage]: { id: own, title: "Imported", icon: null },
    });
  });

  it("drops uploaded icons, which a reader without an account can't load", async () => {
    const uploaded = serializeIconValue({
      version: 1,
      kind: "image",
      authority: "private-icon",
      assetId: "11111111-1111-4111-8111-111111111111",
    });
    const linked = serializeIconValue({
      version: 1,
      kind: "image",
      authority: "url",
      assetId: "https://cdn.example.test/icon.png",
    });
    const parent = await page({ icon: uploaded });
    const child = await page({ parentId: parent, icon: linked });

    const context = await contextFor(child);

    expect(context.icon).toEqual({
      version: 1,
      kind: "image",
      authority: "url",
      assetId: "https://cdn.example.test/icon.png",
    });
    expect(context.ancestors[0]?.icon).toBeNull();
    expect(JSON.stringify(context)).not.toContain(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("survives a parent loop without repeating pages", async () => {
    const first = await page();
    const second = await page({ parentId: first });
    await db
      .update(schema.documents)
      .set({ parentId: second })
      .where(eq(schema.documents.id, first));

    const context = await contextFor(second);

    expect(context.ancestors.map((ancestor) => ancestor.id)).toEqual([first]);
  });
});
