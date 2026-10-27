import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

const TEST_DB_PATH = join(
  tmpdir(),
  `adopt-document-snapshot-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "adopt-owner@example.com";
let DOCUMENT_ID = "adopt-document";
let testRun = 0;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let adoptDocumentSnapshot: typeof import("./adopt-document-snapshot.js").default;
let documentRevisionToken: typeof import("../server/lib/document-revision.js").documentRevisionToken;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  adoptDocumentSnapshot = (await import("./adopt-document-snapshot.js"))
    .default;
  ({ documentRevisionToken } =
    await import("../server/lib/document-revision.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

beforeEach(async () => {
  // Each test gets its own page, since stored live docs outlast the rows.
  DOCUMENT_ID = `adopt-document-${++testRun}`;
  await getDb().delete(schema.documents);
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Page",
    content: "Outside paragraph.",
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
});

function proposal(clientID: number): string {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, "Outside paragraph.");
  paragraph.insert(0, [text]);
  doc.getXmlFragment("default").insert(0, [paragraph]);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return Buffer.from(update).toString("base64");
}

function body(stateBase64: string): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(stateBase64, "base64")));
    return doc.getXmlFragment("default").toString();
  } finally {
    doc.destroy();
  }
}

async function currentRevision(): Promise<string> {
  const [row] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, DOCUMENT_ID));
  return documentRevisionToken(row!.bodyRevision, row!.content ?? "");
}

function adopt(
  input: { revision: string; adoptionUpdateBase64: string },
  options: { userEmail?: string; caller?: "frontend" } = {},
) {
  const userEmail = options.userEmail ?? OWNER;
  return runWithRequestContext({ userEmail }, () =>
    adoptDocumentSnapshot.run({ id: DOCUMENT_ID, ...input }, {
      caller: options.caller ?? "frontend",
      userEmail,
    } as never),
  );
}

describe("adopt-document-snapshot", () => {
  it("takes the saved body into the live doc once for every open editor", async () => {
    const revision = await currentRevision();
    const first = await adopt({
      revision,
      adoptionUpdateBase64: proposal(10),
    });
    const second = await adopt({
      revision,
      adoptionUpdateBase64: proposal(20),
    });
    expect(first.status).toBe("adopted");
    expect(second.status).toBe("already-adopted");
    // The saved body travels with the revision, for editors that rebuild on it.
    expect(second.adoptedBody).toBe("Outside paragraph.");
    expect(body(second.stateBase64)).toBe(
      "<paragraph>Outside paragraph.</paragraph>",
    );
  });

  it("refuses a revision the saved body has moved past", async () => {
    const revision = await currentRevision();
    await getDb()
      .update(schema.documents)
      .set({ content: "Newer body.", bodyRevision: 1 })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    const result = await adopt({
      revision,
      adoptionUpdateBase64: proposal(10),
    });
    expect(result.status).toBe("stale");
    expect(body(result.stateBase64)).toBe("");
  });

  it("belongs to the browser editor of someone who can edit the page", async () => {
    const revision = await currentRevision();
    const input = { revision, adoptionUpdateBase64: proposal(10) };
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        adoptDocumentSnapshot.run({ id: DOCUMENT_ID, ...input }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      adopt(input, { userEmail: "outsider@example.com" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
