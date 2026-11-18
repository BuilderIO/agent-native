import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  privateMedia,
  privateMediaStore,
} from "@agent-native/core/private-media";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { H3 } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { firstRow } from "./first-row.js";

const owners = vi.hoisted(() => new Map<string, string>());
const session = vi.hoisted(() => ({ email: "" }));
const notify = vi.hoisted(() => ({
  edited: vi.fn(async (_input: unknown) => undefined),
}));
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
    return {
      kind: "bytes",
      media: {
        id,
        ownerEmail,
        orgId: null,
        mimeType: "image/png",
        filename: null,
        size: 3,
        createdAt: 0,
      },
      data: new Uint8Array([1, 2, 3]),
    };
  },
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));
vi.mock("./comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => undefined),
  notifyEditedCommentMentions: notify.edited,
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-images-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "page-owner@example.test";
const COMMENTER = "page-commenter@example.test";
const VIEWER = "page-viewer@example.test";
const OTHER = "someone-else@example.test";

let db: ReturnType<typeof import("../db/index.js").getDb>;
let schema: typeof import("../db/schema.js");
let bindUploadedPrivateMedia: typeof import("./private-media-references.js").bindUploadedPrivateMedia;
let addComment: typeof import("../../actions/add-comment.js").default;
let updateComment: typeof import("../../actions/update-comment.js").default;
let listComments: typeof import("../../actions/list-comments.js").default;
let readMedia: H3["request"];
let count = 0;

function mediaId() {
  return `21111111-1111-4111-8111-2${String(++count).padStart(11, "0")}`;
}

function image(id: string) {
  return {
    url: `/api/private-media/${id}`,
    name: "shot.png",
    contentType: "image/png",
  };
}

async function uploaded(
  ownerEmail: string,
  documentId: string,
  mimeType = "image/png",
) {
  const id = mediaId();
  owners.set(id, ownerEmail);
  await db.insert(privateMedia).values({
    id,
    ownerEmail,
    mimeType,
    size: 3,
    sha256: "0",
    blobHandleJson: "{}",
    createdAt: 0,
  });
  await bindUploadedPrivateMedia({ documentId, mediaId: id });
  return id;
}

async function page() {
  const id = `comment-images-doc-${++count}`;
  await db.insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    orgId: null,
    title: "Comment images",
    content: "Some text",
    visibility: "private",
  });
  for (const [principalId, role] of [
    [COMMENTER, "commenter"],
    [VIEWER, "viewer"],
  ] as const) {
    await db.insert(schema.documentShares).values({
      id: `comment-images-share-${++count}`,
      resourceId: id,
      principalType: "user",
      principalId,
      role,
      createdBy: OWNER,
    });
  }
  return id;
}

async function as<T>(userEmail: string, run: () => T | Promise<T>): Promise<T> {
  return runWithRequestContext(
    { userEmail, requestOrigin: "https://content.test" },
    run,
  );
}

function comment(
  userEmail: string,
  documentId: string,
  attachments: unknown[],
) {
  return as(userEmail, () =>
    addComment.run({
      documentId,
      content: "Here's what I see",
      attachments,
    }),
  );
}

function stored(images: string | null) {
  return JSON.parse(images ?? "[]") as unknown;
}

async function storedImages(commentId: string) {
  const rows = await db
    .select({ attachmentsJson: schema.documentComments.attachmentsJson })
    .from(schema.documentComments)
    .where(eq(schema.documentComments.id, commentId));
  expect(rows).toHaveLength(1);
  return firstRow(rows)?.attachmentsJson ?? null;
}

async function status(id: string, email = "", query = "") {
  session.email = email;
  try {
    return (await readMedia(`http://content.test/media/${id}${query}`)).status;
  } finally {
    session.email = "";
  }
}

async function agentLinkQuery(documentId: string, id: string) {
  const listed = await as(VIEWER, () =>
    listComments.run({ documentId }, { caller: "mcp" }),
  );
  const link = listed.privateMediaLinks?.links.find(
    ({ src }) => src === `/api/private-media/${id}`,
  )?.url;
  if (!link) throw new Error("The agent got no link");
  return new URL(link).search;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const module = await import("../db/index.js");
  db = module.getDb();
  schema = module.schema;
  ({ bindUploadedPrivateMedia } =
    await import("./private-media-references.js"));
  addComment = (await import("../../actions/add-comment.js")).default;
  updateComment = (await import("../../actions/update-comment.js")).default;
  listComments = (await import("../../actions/list-comments.js")).default;
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

describe("comment images", () => {
  it("shows a commenter's screenshot to the page's readers and no one else", async () => {
    const doc = await page();
    const id = await uploaded(COMMENTER, doc);
    expect(await status(id, VIEWER)).toBe(404);
    expect(await status(id, COMMENTER)).toBe(200);

    const created = await comment(COMMENTER, doc, [image(id)]);
    expect(await status(id, VIEWER)).toBe(200);
    expect(await status(id, OWNER)).toBe(200);
    expect(await status(id, OTHER)).toBe(404);
    expect(await status(id)).toBe(404);

    const listed = await as(VIEWER, () =>
      listComments.run({ documentId: doc }, { caller: "frontend" }),
    );
    expect(
      listed.comments.find((row: { id: string }) => row.id === created.id)
        ?.attachments,
    ).toEqual([image(id)]);
    expect(listed.privateMediaLinks).toBeUndefined();
  });

  it("gives an agent reading the comments a link that opens each image", async () => {
    const doc = await page();
    const id = await uploaded(COMMENTER, doc);
    await comment(COMMENTER, doc, [image(id)]);
    const listed = await as(VIEWER, () =>
      listComments.run({ documentId: doc }, { caller: "mcp" }),
    );
    expect(listed.privateMediaLinks?.links).toEqual([
      {
        src: `/api/private-media/${id}`,
        url: expect.stringContaining(`/api/private-media/${id}?`),
      },
    ]);
    const link = listed.privateMediaLinks?.links.find(
      ({ src }) => src === `/api/private-media/${id}`,
    )?.url;
    if (!link) throw new Error("The agent got no link");
    expect(await status(id)).toBe(404);
    expect(await status(id, "", new URL(link).search)).toBe(200);
  });

  it("stops showing it, through agent links too, once the comment is deleted or the page is in Trash", async () => {
    const deleted = await page();
    const gone = await uploaded(COMMENTER, deleted);
    const created = await comment(COMMENTER, deleted, [image(gone)]);
    const goneLink = await agentLinkQuery(deleted, gone);
    expect(await status(gone, VIEWER)).toBe(200);
    expect(await status(gone, "", goneLink)).toBe(200);
    await db
      .delete(schema.documentComments)
      .where(eq(schema.documentComments.id, created.id));
    expect(await status(gone, VIEWER)).toBe(404);
    expect(await status(gone, "", goneLink)).toBe(404);
    expect(await status(gone, COMMENTER)).toBe(200);

    const trashed = await page();
    const hidden = await uploaded(COMMENTER, trashed);
    await comment(COMMENTER, trashed, [image(hidden)]);
    const hiddenLink = await agentLinkQuery(trashed, hidden);
    expect(await status(hidden, "", hiddenLink)).toBe(200);
    await db
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, trashed));
    expect(await status(hidden, VIEWER)).toBe(404);
    expect(await status(hidden, OWNER)).toBe(404);
    expect(await status(hidden, "", hiddenLink)).toBe(404);
  });

  it("opens an agent's link only while a comment on the page it was read from carries the image", async () => {
    const first = await page();
    const second = await page();
    const id = await uploaded(COMMENTER, first);
    await bindUploadedPrivateMedia({ documentId: second, mediaId: id });
    const onFirst = await comment(COMMENTER, first, [image(id)]);
    await comment(COMMENTER, second, [image(id)]);
    const firstLink = await agentLinkQuery(first, id);
    const secondLink = await agentLinkQuery(second, id);
    expect(await status(id, "", firstLink)).toBe(200);

    await db
      .delete(schema.documentComments)
      .where(eq(schema.documentComments.id, onFirst.id));
    expect(await status(id, "", firstLink)).toBe(404);
    expect(await status(id, "", secondLink)).toBe(200);
  });

  it("opens nothing through a comment row filed under another owner", async () => {
    const doc = await page();
    const id = await uploaded(OTHER, doc);
    await db.insert(schema.documentComments).values({
      id: `comment-images-forged-${++count}`,
      documentId: doc,
      threadId: `comment-images-forged-${count}`,
      content: "Forged",
      authorEmail: OTHER,
      ownerEmail: OTHER,
      attachmentsJson: JSON.stringify([image(id)]),
    });
    expect(await status(id, VIEWER)).toBe(404);
  });

  it("opens nothing through a comment whose image was uploaded to another page", async () => {
    const doc = await page();
    const elsewhere = await page();
    const id = await uploaded(COMMENTER, elsewhere);
    await db.insert(schema.documentComments).values({
      id: `comment-images-unbound-${++count}`,
      documentId: doc,
      threadId: `comment-images-unbound-${count}`,
      content: "Imported",
      authorEmail: COMMENTER,
      ownerEmail: OWNER,
      attachmentsJson: JSON.stringify([image(id)]),
    });
    expect(await status(id, VIEWER)).toBe(404);
    const listed = await as(VIEWER, () =>
      listComments.run({ documentId: doc }, { caller: "mcp" }),
    );
    expect(listed.privateMediaLinks).toBeUndefined();
  });

  it("attaches only images the writer uploaded to this page", async () => {
    const doc = await page();
    const elsewhere = await page();
    const ownersImage = await uploaded(OWNER, doc);
    const otherPagesImage = await uploaded(COMMENTER, elsewhere);
    for (const attachments of [
      [image(ownersImage)],
      [image(otherPagesImage)],
      [image(mediaId())],
    ]) {
      await expect(comment(COMMENTER, doc, attachments)).rejects.toMatchObject({
        errorCode: "comment_image_not_attachable",
      });
    }
    await expect(
      comment(COMMENTER, doc, [{ url: "https://tracker.test/pixel.png" }]),
    ).rejects.toMatchObject({ errorCode: "comment_image_invalid" });
    expect(await status(ownersImage, COMMENTER)).toBe(404);

    const repeated = await uploaded(COMMENTER, doc);
    const once = await comment(
      COMMENTER,
      doc,
      Array.from({ length: 6 }, () => image(repeated)),
    );
    expect(stored(await storedImages(once.id))).toEqual([image(repeated)]);
    const six = await Promise.all(
      Array.from({ length: 6 }, () => uploaded(COMMENTER, doc)),
    );
    await expect(comment(COMMENTER, doc, six.map(image))).rejects.toMatchObject(
      { errorCode: "comment_too_many_images" },
    );
  });

  it("takes PNG, JPEG, GIF or WebP uploads, by the type each was stored with", async () => {
    const doc = await page();
    const svg = await uploaded(COMMENTER, doc, "image/svg+xml");
    for (const attachment of [
      image(svg),
      { url: `/api/private-media/${svg}`, name: "art.svg" },
    ]) {
      await expect(comment(COMMENTER, doc, [attachment])).rejects.toMatchObject(
        { errorCode: "comment_image_invalid" },
      );
    }
    const types = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    const ids = await Promise.all(
      types.map((type) => uploaded(COMMENTER, doc, type)),
    );
    const created = await comment(COMMENTER, doc, ids.map(image));
    expect(stored(await storedImages(created.id))).toEqual(
      ids.map((id, at) => ({ ...image(id), contentType: types[at] })),
    );
  });

  it("lets an agent keep a comment's images but not attach any", async () => {
    const doc = await page();
    const kept = await uploaded(COMMENTER, doc);
    const another = await uploaded(COMMENTER, doc);
    const created = await comment(COMMENTER, doc, [image(kept)]);
    await expect(
      as(COMMENTER, () =>
        addComment.run(
          {
            documentId: doc,
            content: "From an agent",
            attachments: [image(another)],
          },
          { caller: "mcp" },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_image_not_attachable" });
    const edit = (attachments: unknown[]) =>
      as(COMMENTER, () =>
        updateComment.run(
          {
            id: created.id,
            documentId: doc,
            content: "Edited by an agent",
            attachments,
          },
          { caller: "mcp" },
        ),
      );
    await expect(edit([image(kept), image(another)])).rejects.toMatchObject({
      errorCode: "comment_image_not_attachable",
    });
    await edit([image(kept)]);
    expect(stored(await storedImages(created.id))).toEqual([image(kept)]);
  });

  it("keeps a comment's images through an edit and takes only the editor's own new ones", async () => {
    const doc = await page();
    const kept = await uploaded(COMMENTER, doc);
    const added = await uploaded(COMMENTER, doc);
    const ownersImage = await uploaded(OWNER, doc);
    const created = await comment(COMMENTER, doc, [image(kept)]);
    const edit = (attachments: unknown[]) =>
      as(COMMENTER, () =>
        updateComment.run({
          id: created.id,
          documentId: doc,
          attachments,
        }),
      );

    await edit([image(kept), image(added)]);
    expect(JSON.parse((await storedImages(created.id)) ?? "[]")).toEqual([
      image(kept),
      image(added),
    ]);
    await expect(edit([image(kept), image(ownersImage)])).rejects.toMatchObject(
      { errorCode: "comment_image_not_attachable" },
    );
    await as(COMMENTER, () =>
      updateComment.run({
        id: created.id,
        documentId: doc,
        content: "Edited",
      }),
    );
    expect(JSON.parse((await storedImages(created.id)) ?? "[]")).toHaveLength(
      2,
    );
    await edit([]);
    expect(await storedImages(created.id)).toBeNull();
    expect(await status(kept, VIEWER)).toBe(404);
    await expect(
      as(COMMENTER, () =>
        updateComment.run({ id: created.id, documentId: doc, content: "" }),
      ),
    ).rejects.toMatchObject({ paths: ["content"] });
    expect(await storedImages(created.id)).toBeNull();
  });

  it("lets an editor keep the author's images on an edit and add their own", async () => {
    const doc = await page();
    const authors = await uploaded(COMMENTER, doc);
    const editors = await uploaded(OWNER, doc);
    const created = await comment(COMMENTER, doc, [image(authors)]);
    await as(OWNER, () =>
      updateComment.run({
        id: created.id,
        documentId: doc,
        attachments: [image(authors), image(editors)],
      }),
    );
    expect(stored(await storedImages(created.id))).toEqual([
      image(authors),
      image(editors),
    ]);
    expect(await status(authors, VIEWER)).toBe(200);
    expect(await status(editors, VIEWER)).toBe(200);

    notify.edited.mockClear();
    await as(COMMENTER, () =>
      updateComment.run({
        id: created.id,
        documentId: doc,
        content: "Here's what I see, @Vic",
        mentions: [{ email: VIEWER, name: "Vic" }],
      }),
    );
    expect(notify.edited).toHaveBeenCalledWith(
      expect.objectContaining({ imageCount: 2 }),
    );
  });
});
