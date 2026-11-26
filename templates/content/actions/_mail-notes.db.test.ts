import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// guard:allow-unscoped — isolated PGlite fixtures read exact rows.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-mail-notes-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "notes-owner@example.com";
const OTHER = "notes-other@example.com";
const THREAD_URL =
  "https://mail.example.com/_agent-native/open?app=mail&view=inbox&threadId=t1";

let notes: typeof import("./_mail-notes.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");

const as = <T>(email: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: email }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  notes = await import("./_mail-notes.js");
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function mailNotesCollections(email: string) {
  return getDb()
    .select({
      id: schema.contentDatabases.id,
      documentId: schema.contentDatabases.documentId,
    })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabases.ownerEmail, email),
        eq(schema.documents.title, notes.MAIL_NOTES_TITLE),
      ),
    )
    .orderBy(schema.documents.createdAt);
}

async function pageOf(documentId: string) {
  const page = (
    await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
  ).at(0);
  if (!page) throw new Error(`Missing page ${documentId}`);
  return page;
}

function idFromUrl(url: string) {
  const id = new URL(url, "https://content.example.com").searchParams.get(
    "documentId",
  );
  if (!id) throw new Error(`No documentId in ${url}`);
  return id;
}

describe("mailNoteLine", () => {
  it("writes one dated list item that keeps the link intact", () => {
    expect(
      notes.mailNoteLine({
        date: "2026-11-25",
        text: "Met at\nthe launch ",
        link: { label: "Re: [Launch] plan", url: "https://x.test/a (b)" },
      }),
    ).toBe(
      "- **2026-11-25** Met at the launch [Re: Launch plan](https://x.test/a%20%28b%29)",
    );
    expect(notes.mailNoteLine({ date: "2026-11-25", text: "No link" })).toBe(
      "- **2026-11-25** No link",
    );
  });
});

describe("Mail notes collection", () => {
  it("reads null before the first note", async () => {
    expect(
      await as(OWNER, () => notes.readMailNote("ada@example.com")),
    ).toBeNull();
  });

  it("creates one private page per person and appends a dated line per note", async () => {
    const first = await as(OWNER, () =>
      notes.addMailNote(
        {
          email: "ada@example.com",
          text: "Met at the launch",
          name: "Ada Lovelace",
          date: "2026-11-25",
          link: { label: "Launch recap", url: THREAD_URL },
        },
        undefined,
      ),
    );
    const second = await as(OWNER, () =>
      notes.addMailNote(
        { email: "ada@example.com", text: "Sent the deck", date: "2026-11-26" },
        undefined,
      ),
    );
    const other = await as(OWNER, () =>
      notes.addMailNote(
        { email: "grace@example.com", text: "Intro from Ada" },
        undefined,
      ),
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(other.created).toBe(true);
    expect(second.note.url).toBe(first.note.url);
    expect(other.note.url).not.toBe(first.note.url);
    expect(second.note.markdown).toContain("**2026-11-25** Met at the launch");
    expect(second.note.markdown).toContain("threadId=t1");
    expect(second.note.markdown).toContain("**2026-11-26** Sent the deck");
    expect(second.note.markdown.indexOf("Met at the launch")).toBeLessThan(
      second.note.markdown.indexOf("Sent the deck"),
    );

    const read = await as(OWNER, () => notes.readMailNote("ada@example.com"));
    expect(read).toEqual(second.note);

    const collections = await mailNotesCollections(OWNER);
    expect(collections).toHaveLength(1);
    const collectionPage = await pageOf(collections[0]?.documentId ?? "");
    expect(collectionPage.title).toBe(notes.MAIL_NOTES_TITLE);
    const page = await pageOf(idFromUrl(first.note.url));
    expect(page.title).toBe("Ada Lovelace");
    expect(page.ownerEmail).toBe(OWNER);
    expect(page.visibility).toBe("private");
  });

  it("keeps each person's notes to their own collection", async () => {
    expect(
      await as(OTHER, () => notes.readMailNote("ada@example.com")),
    ).toBeNull();
    expect(await mailNotesCollections(OTHER)).toHaveLength(0);
  });

  it("refuses a trashed note page instead of reading it as empty", async () => {
    const note = await as(OWNER, () => notes.readMailNote("grace@example.com"));
    if (!note) throw new Error("Expected Grace's note.");
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, idFromUrl(note.url)));

    await expect(
      as(OWNER, () => notes.readMailNote("grace@example.com")),
    ).rejects.toMatchObject({
      errorCode: "mail_note_trashed",
      statusCode: 409,
    });
    await expect(
      as(OWNER, () =>
        notes.addMailNote(
          { email: "grace@example.com", text: "Still here?" },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "mail_note_trashed" });
  });

  it("starts a new collection when the old one is trashed", async () => {
    const old = (await mailNotesCollections(OWNER)).at(0);
    if (!old) throw new Error("Expected the first collection.");
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, old.documentId));

    expect(
      await as(OWNER, () => notes.readMailNote("ada@example.com")),
    ).toBeNull();
    const fresh = await as(OWNER, () =>
      notes.addMailNote(
        { email: "ada@example.com", text: "Fresh start" },
        undefined,
      ),
    );
    expect(fresh.created).toBe(true);
    expect(fresh.note.markdown).toContain("Fresh start");
    expect(fresh.note.markdown).not.toContain("Met at the launch");
    expect(await mailNotesCollections(OWNER)).toHaveLength(2);
  });
});
