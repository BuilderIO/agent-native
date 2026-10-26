import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const loads = vi.hoisted(() => ({ document: 0, collection: 0 }));

vi.mock("../shared/document-export.js", async (importOriginal) => {
  loads.document += 1;
  return importOriginal();
});
vi.mock("../shared/database-collection-export.js", async (importOriginal) => {
  loads.collection += 1;
  return importOriginal();
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-export-renderers-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";

let exportDocumentAction: typeof import("./export-document.js").default;
let updatedAt: string;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const { getDb, schema } = await import("../server/db/index.js");
  exportDocumentAction = (await import("./export-document.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  updatedAt = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: "renderers-page",
    ownerEmail: OWNER,
    parentId: null,
    title: "Renderers Page",
    content: "Page body with $x^2$ math",
    position: 0,
    visibility: "private",
    createdAt: updatedAt,
    updatedAt,
  });
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("export-document renderers", () => {
  it("load when an export runs, once, and render what they render when imported directly", async () => {
    expect(loads).toEqual({ document: 0, collection: 0 });

    const exportPage = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        exportDocumentAction.run({ id: "renderers-page", format: "html" }),
      );
    const first = await exportPage();
    const second = await exportPage();

    expect(loads).toEqual({ document: 1, collection: 0 });

    const { buildDocumentExport } =
      await import("../shared/document-export.js");
    const direct = buildDocumentExport({
      id: "renderers-page",
      title: "Renderers Page",
      content: "Page body with $x^2$ math",
      updatedAt,
      format: "html",
      blocksFields: [],
    });
    expect({ ...first, deepLink: undefined }).toEqual({
      ...direct,
      deepLink: undefined,
    });
    expect(second).toEqual(first);
    expect(first.content).toContain("katex");
  });
});
