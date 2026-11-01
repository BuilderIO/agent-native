import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec, withDbExec, type DbExec } from "@agent-native/core/db";
import {
  privateMedia,
  privateMediaStore,
} from "@agent-native/core/private-media";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { H3 } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const owners = vi.hoisted(() => new Map<string, string>());
const redirects = vi.hoisted(() => new Set<string>());
const session = vi.hoisted(() => ({ email: "" }));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getSession: async () => (session.email ? { email: session.email } : null),
}));
vi.mock("@agent-native/core/private-media", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/private-media")
  >()),
  ownsPrivateMedia: async (id: string, email: string | null | undefined) =>
    !!email && owners.get(id) === email.trim().toLowerCase(),
  openPrivateMediaForAuthorizedReader: async (id: string) => {
    const ownerEmail = owners.get(id);
    if (!ownerEmail) return null;
    const svg = id.startsWith("5");
    const media = {
      id,
      ownerEmail,
      orgId: null,
      mimeType: svg ? "image/svg+xml" : "image/png",
      filename: null,
      size: 3,
      createdAt: 0,
    };
    return redirects.has(id)
      ? { kind: "redirect", media, url: "https://storage.test/signed" }
      : { kind: "bytes", media, data: new Uint8Array([1, 2, 3]) };
  },
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-private-media-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "media-owner@example.test";
const SHARED = "media-shared@example.test";
const OTHER = "media-other@example.test";

let db: ReturnType<typeof import("../db/index.js").getDb>;
let drizzleOverExec: typeof import("../db/exec.js").drizzleOverExec;
let schema: typeof import("../db/schema.js");
let refs: typeof import("./private-media-references.js");
let updateDocumentAction: typeof import("../../actions/update-document.js").default;
let readMedia: H3["request"];
let count = 0;

function mediaId(prefix = "1") {
  const n = String(++count).padStart(11, "0");
  return `${prefix}1111111-1111-4111-8111-${prefix}${n}`;
}

/** Records an upload where binding reads it and where the route's mocks do. */
async function uploaded(id: string, ownerEmail: string) {
  owners.set(id, ownerEmail);
  await db.insert(privateMedia).values({
    id,
    ownerEmail,
    mimeType: "image/png",
    size: 3,
    sha256: "0",
    blobHandleJson: "{}",
    createdAt: 0,
  });
}

function body(...ids: string[]) {
  return ids.map((id) => `![](/api/private-media/${id})`).join("\n\n");
}

async function document(
  options: {
    ownerEmail?: string;
    visibility?: "private" | "public";
    content?: string;
    spaceId?: string;
  } = {},
) {
  const id = `private-media-doc-${++count}`;
  await db.insert(schema.documents).values({
    id,
    ownerEmail: options.ownerEmail ?? OWNER,
    orgId: null,
    spaceId: options.spaceId ?? null,
    title: "Media test",
    content: options.content ?? "",
    visibility: options.visibility ?? "private",
  });
  return id;
}

async function share(documentId: string, principalId = SHARED) {
  await db.insert(schema.documentShares).values({
    id: `private-media-share-${++count}`,
    resourceId: documentId,
    principalType: "user",
    principalId,
    role: "viewer",
    createdBy: OWNER,
  });
}

async function references(documentId: string, id: string) {
  return db
    .select()
    .from(schema.privateMediaReferences)
    .where(
      and(
        eq(schema.privateMediaReferences.documentId, documentId),
        eq(schema.privateMediaReferences.mediaId, id),
      ),
    );
}

function canRead(id: string, userEmail?: string) {
  return runWithRequestContext(userEmail ? { userEmail } : {}, () =>
    refs.canReadPrivateMediaThroughDocument(id),
  );
}

function save(documentId: string, content: string, userEmail = OWNER) {
  return runWithRequestContext({ userEmail }, () =>
    refs.syncPrivateMediaReferences(db, {
      documentId,
      after: content,
      userEmail,
    }),
  );
}

async function get(id: string, email = "") {
  session.email = email;
  try {
    return await readMedia(`http://content.test/media/${id}`);
  } finally {
    session.email = "";
  }
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const module = await import("../db/index.js");
  db = module.getDb();
  schema = module.schema;
  drizzleOverExec = (await import("../db/exec.js")).drizzleOverExec;
  refs = await import("./private-media-references.js");
  updateDocumentAction = (await import("../../actions/update-document.js"))
    .default;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  await privateMediaStore.ready();
  const route = (await import("../routes/api/private-media/[id].get.js"))
    .default;
  const app = new H3();
  app.get("/media/:id", route);
  readMedia = app.request.bind(app);
}, 60_000);

afterAll(() => rmSync(TEST_DB_PATH, { recursive: true, force: true }));

describe("private media references", () => {
  it("serves an image to the page's readers and refuses everyone else alike", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    const content = body(id);
    const page = await document({ content });
    await share(page);
    await save(page, content);
    expect(await references(page, id)).toHaveLength(1);

    await expect(canRead(id, OWNER)).resolves.toBe(true);
    await expect(canRead(id, SHARED)).resolves.toBe(true);
    await expect(canRead(id, OTHER)).resolves.toBe(false);
    await expect(canRead(id)).resolves.toBe(false);

    const shared = await get(id, SHARED);
    expect(shared.status).toBe(200);
    expect(new Uint8Array(await shared.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(shared.headers.get("content-type")).toBe("image/png");
    expect(shared.headers.get("cache-control")).toBe("private, no-store");
    expect(shared.headers.get("x-content-type-options")).toBe("nosniff");

    const outsider = await get(id, OTHER);
    const anonymous = await get(id);
    const unknown = await get(mediaId(), SHARED);
    const malformed = await get("not-an-id", SHARED);
    for (const response of [outsider, anonymous, unknown, malformed]) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("does not bind an image ID the saver cannot already see", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    await document({ content: body(id) });
    const content = body(id);
    const forged = await document({ ownerEmail: OTHER, content });
    await save(forged, content, OTHER);
    expect(await references(forged, id)).toHaveLength(0);
    await expect(canRead(id, OTHER)).resolves.toBe(false);
  });

  it("lets a reader copy an image they can see into their own page", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    const content = body(id);
    const source = await document({ content });
    await share(source);
    await save(source, content);

    const copy = await document({ ownerEmail: SHARED, content });
    await share(copy, OTHER);
    await save(copy, content, SHARED);
    expect(await references(copy, id)).toHaveLength(1);
    await expect(canRead(id, OTHER)).resolves.toBe(true);
  });

  it("stops serving when the page drops the link or goes to Trash, and resumes on restore", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    const content = body(id);
    const page = await document({ content });
    await share(page);
    await save(page, content);

    await db
      .update(schema.documents)
      .set({ content: "Edited" })
      .where(eq(schema.documents.id, page));
    await expect(canRead(id, SHARED)).resolves.toBe(false);
    expect((await get(id, SHARED)).status).toBe(404);

    await db
      .update(schema.documents)
      .set({ content })
      .where(eq(schema.documents.id, page));
    await expect(canRead(id, SHARED)).resolves.toBe(true);

    await db
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, page));
    await expect(canRead(id, SHARED)).resolves.toBe(false);
  });

  it("stops serving when the collection holding the page is deleted", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    const content = body(id);
    const collectionPage = await document();
    const item = await document({ content });
    await share(item);
    await save(item, content);
    await expect(canRead(id, SHARED)).resolves.toBe(true);

    const databaseId = `private-media-db-${++count}`;
    await db.insert(schema.contentDatabases).values({
      id: databaseId,
      ownerEmail: OWNER,
      documentId: collectionPage,
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: `private-media-item-${++count}`,
      ownerEmail: OWNER,
      databaseId,
      documentId: item,
    });
    await expect(canRead(id, SHARED)).resolves.toBe(true);

    await db
      .update(schema.contentDatabases)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schema.contentDatabases.id, databaseId));
    await expect(canRead(id, SHARED)).resolves.toBe(false);
    expect((await get(id, SHARED)).status).toBe(404);
  });

  it("serves an image on a public page without a session", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    const content = body(id);
    const page = await document({ visibility: "public", content });
    await save(page, content);
    await expect(canRead(id)).resolves.toBe(true);
    expect((await get(id)).status).toBe(200);
  });

  it("refuses an anonymous reader of a private space page with the same 404", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    const content = body(id);
    const page = await document({ spaceId: "private-media-space", content });
    await save(page, content);
    await expect(canRead(id)).resolves.toBe(false);
    expect((await get(id)).status).toBe(404);
  });

  it("serves an unsaved image to its uploader only", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    expect((await get(id, OWNER)).status).toBe(200);
    expect((await get(id, SHARED)).status).toBe(404);
  });

  it("redirects to storage's short-lived link, and sandboxes SVG", async () => {
    const linked = mediaId();
    await uploaded(linked, OWNER);
    redirects.add(linked);
    const redirected = await get(linked, OWNER);
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get("location")).toBe(
      "https://storage.test/signed",
    );
    expect(redirected.headers.get("cache-control")).toBe("private, no-store");

    const svg = mediaId("5");
    await uploaded(svg, OWNER);
    const response = await get(svg, OWNER);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
  });

  it("binds images when update-document saves a body", async () => {
    const id = mediaId();
    await uploaded(id, OWNER);
    const page = await document();
    await share(page);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: page, content: body(id) }),
    );
    expect(await references(page, id)).toHaveLength(1);
    await expect(canRead(id, SHARED)).resolves.toBe(true);
  });

  it("checks a save's new images on the save's own transaction", async () => {
    const own = mediaId();
    const copied = mediaId();
    await uploaded(own, SHARED);
    await uploaded(copied, OWNER);
    const source = await document({ content: body(copied) });
    await share(source);
    await save(source, body(copied));
    const content = body(own, copied);
    const page = await document({ ownerEmail: SHARED, content });

    // A live-copy save holds a raw transaction, scoped as core scopes it.
    // A check that queried another connection would wait on this one.
    const exec = getDbExec();
    assert(exec.transaction);
    const statements: string[] = [];
    await exec.transaction(async (tx) => {
      // raw-sql-ok: records and forwards the checks' own statements unchanged.
      const recorded: DbExec = {
        execute(input) {
          statements.push(typeof input === "string" ? input : input.sql);
          return tx.execute(input);
        },
      };
      await runWithRequestContext({ userEmail: SHARED }, () =>
        withDbExec(recorded, () =>
          refs.syncPrivateMediaReferences(drizzleOverExec(recorded), {
            documentId: page,
            after: content,
            userEmail: SHARED,
          }),
        ),
      );
    });
    expect(await references(page, own)).toHaveLength(1);
    expect(await references(page, copied)).toHaveLength(1);
    // Ownership, the pages that link the copy, and the access rules.
    const ran = (pattern: RegExp) =>
      statements.some((sql) => pattern.test(sql));
    expect(ran(/from "private_media"/)).toBe(true);
    expect(
      ran(/from "content_private_media_references" inner join "documents"/),
    ).toBe(true);
    expect(ran(/from "document_shares"/)).toBe(true);

    // update-document saves in a Drizzle transaction instead.
    const viaAction = await document({ ownerEmail: SHARED });
    await runWithRequestContext({ userEmail: SHARED }, () =>
      updateDocumentAction.run({ id: viaAction, content: body(copied) }),
    );
    expect(await references(viaAction, copied)).toHaveLength(1);
  });
});
