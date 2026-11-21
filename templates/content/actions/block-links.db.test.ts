import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { blocksFieldTreeShape } from "../shared/blocks-field-identity.js";
import { nfmToDoc, type PMNode } from "../shared/nfm.js";

// guard:allow-unscoped — isolated PGlite fixtures read exact rows.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-block-links-${process.pid}-${Date.now()}.pglite`,
);
const OUTSIDER = "outsider@example.com";
let ownerSequence = 0;
let ownerEmail = "link-owner-0@example.com";

let createDatabase: typeof import("./create-content-database.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let createRow: typeof import("./add-database-item.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let updateDocument: typeof import("./update-document.js").default;
let getBodyBlockIds: typeof import("./get-body-block-ids.js").default;
let resolveBlockLink: typeof import("./resolve-block-link.js").default;

const as = <T>(email: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: email }, run);

beforeEach(() => {
  ownerEmail = `link-owner-${++ownerSequence}@example.com`;
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  createDatabase = (await import("./create-content-database.js")).default;
  getDatabase = (await import("./get-content-database.js")).default;
  createRow = (await import("./add-database-item.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  getBodyBlockIds = (await import("./get-body-block-ids.js")).default;
  resolveBlockLink = (await import("./resolve-block-link.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function rowPage(markdown: string) {
  const created = await as(ownerEmail, () =>
    createDatabase.run({ title: "Block link fixture" }),
  );
  const databaseId = created.database.id;
  const initial = await as(ownerEmail, () => getDatabase.run({ databaseId }));
  if (!("database" in initial) || !initial.mutationContract) {
    throw new Error("Fixture database has no mutation contract.");
  }
  const contract = initial.mutationContract;
  const primary = contract.properties.find((p) => p.type === "blocks");
  if (!primary) throw new Error("Fixture database has no Blocks property.");
  const row = await as(ownerEmail, () =>
    createRow.run({
      target: contract.target,
      expectedSchemaRevision: contract.schemaRevision,
      idempotencyKey: `create-row-${databaseId}`,
      title: "Linked row",
    }),
  );
  const documentId = row.receipt.row.documentId;
  await as(ownerEmail, () =>
    setProperty.run({
      databaseId,
      documentId,
      propertyId: primary.id,
      value: markdown,
      expectedBlocksFieldRevision: 0,
    }),
  );
  const read = await readIds(documentId);
  if (!read.ids) throw new Error("Fixture page has no block IDs.");
  return { documentId, ids: Object.values(read.ids.idsByPath) };
}

function idAt(ids: readonly string[], index: number) {
  const id = ids.find((_, position) => position === index);
  if (id === undefined) {
    throw new Error(`Expected block ${index} in the fixture.`);
  }
  return id;
}

function byPath(...ids: (string | undefined)[]): Record<string, string> {
  return Object.fromEntries(
    ids.flatMap((id, index) => (id === undefined ? [] : [[`${index}`, id]])),
  );
}

const shapeOf = (markdown: string) =>
  blocksFieldTreeShape(nfmToDoc(markdown) as PMNode);

function readIds(documentId: string, email = ownerEmail) {
  return as(email, () => getBodyBlockIds.run({ documentId }));
}

function resolve(documentId: string, blockId: string, email = ownerEmail) {
  return as(email, () => resolveBlockLink.run({ documentId, blockId }));
}

function save(
  documentId: string,
  content: string,
  idsByPath?: Record<string, string>,
  shape = shapeOf(content),
) {
  return as(ownerEmail, () =>
    updateDocument.run({
      id: documentId,
      content,
      ...(idsByPath ? { editorBlockIds: { shape, idsByPath } } : {}),
    }),
  );
}

describe("block links", () => {
  it("reads the same IDs for every editor of a collection page, and links find them", async () => {
    const { documentId, ids } = await rowPage("Alpha\nBeta\nGamma");

    expect(new Set(ids).size).toBe(3);
    await expect(readIds(documentId)).resolves.toEqual({
      ids: { shape: shapeOf("Alpha\nBeta\nGamma"), idsByPath: byPath(...ids) },
    });
    for (const [index, id] of ids.entries()) {
      await expect(resolve(documentId, id)).resolves.toEqual({
        state: "live",
        path: `${index}`,
      });
    }
    await expect(readIds(documentId, OUTSIDER)).resolves.toEqual({ ids: null });
  });

  it("keeps the IDs the editor names, even when two blocks trade text", async () => {
    const { documentId, ids } = await rowPage("Alpha\nBeta\nGamma");
    await save(documentId, "Beta\nAlpha\nGamma", byPath(...ids));

    expect((await readIds(documentId)).ids?.idsByPath).toEqual({
      "0": ids[0],
      "1": ids[1],
      "2": ids[2],
    });
  });

  it("ignores the editor's IDs when the saved text has another shape", async () => {
    const { documentId, ids } = await rowPage("Alpha\nBeta\nGamma");
    await save(
      documentId,
      "Beta\nAlpha\nGamma",
      byPath(...ids),
      "shape_of_another_tree",
    );

    expect((await readIds(documentId)).ids?.idsByPath).toEqual({
      "0": ids[1],
      "1": ids[0],
      "2": ids[2],
    });
  });

  it("finds a linked block, says when it was deleted, and finds it again after undo", async () => {
    const { documentId, ids } = await rowPage("Alpha\nBeta\nGamma");
    const beta = idAt(ids, 1);
    await expect(resolve(documentId, beta)).resolves.toEqual({
      state: "live",
      path: "1",
    });

    await save(documentId, "Alpha\nGamma", byPath(idAt(ids, 0), idAt(ids, 2)));
    await expect(resolve(documentId, beta)).resolves.toEqual({
      state: "deleted",
    });

    await save(
      documentId,
      "Alpha\nBeta, restored\nGamma",
      byPath(idAt(ids, 0), beta, idAt(ids, 2)),
    );
    await expect(resolve(documentId, beta)).resolves.toEqual({
      state: "live",
      path: "1",
    });
  });

  it("says a link is missing for a block the page never had, or to a reader without access", async () => {
    const { documentId, ids } = await rowPage("Alpha");

    await expect(resolve(documentId, "block_elsewhere")).resolves.toEqual({
      state: "missing",
    });
    await expect(resolve(documentId, idAt(ids, 0), OUTSIDER)).resolves.toEqual({
      state: "missing",
    });
  });
});
