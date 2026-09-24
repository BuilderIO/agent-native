import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const localDb = vi.hoisted(() => ({
  pglite: null as null | {
    query(
      sql: string,
      args?: unknown[],
    ): Promise<{ rows: Array<Record<string, unknown>> }>;
    close(): Promise<void>;
  },
  putPrivateBlob: vi.fn(),
  deletePrivateBlob: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob: localDb.deletePrivateBlob,
  putPrivateBlob: localDb.putPrivateBlob,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: localDb.assertAccess,
}));

vi.mock("../server/db/index.js", async () => {
  const [{ createRequire }, { drizzle }, pgCore] = await Promise.all([
    import("node:module"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pg-core"),
  ]);
  const { PGlite } = createRequire(
    new URL("../../../../packages/core/package.json", import.meta.url),
  )("@electric-sql/pglite");
  const designs = pgCore.pgTable("designs", {
    id: pgCore.text("id").primaryKey(),
  });
  const designFiles = pgCore.pgTable("design_files", {
    id: pgCore.text("id").primaryKey(),
    designId: pgCore.text("design_id").notNull(),
    content: pgCore.text("content").notNull(),
    fileType: pgCore.text("file_type").notNull(),
  });
  const designVisualEditSnapshots = pgCore.pgTable(
    "design_visual_edit_snapshots",
    {
      designId: pgCore.text("design_id").notNull(),
      fileId: pgCore.text("file_id").notNull(),
      html: pgCore.text("html").notNull(),
      blobHandle: pgCore.text("blob_handle"),
      captureRevision: pgCore
        .bigint("capture_revision", { mode: "bigint" })
        .notNull()
        .default(0n),
      publishedRevision: pgCore
        .bigint("published_revision", {
          mode: "bigint",
        })
        .notNull()
        .default(0n),
      updatedAt: pgCore.text("updated_at"),
      visibility: pgCore.text("visibility").notNull(),
      ownerEmail: pgCore.text("owner_email").notNull(),
      orgId: pgCore.text("org_id"),
    },
    (table) => [pgCore.primaryKey({ columns: [table.designId, table.fileId] })],
  );
  const pglite = await PGlite.create("memory://");
  await pglite.exec(`
    CREATE TABLE designs (id TEXT PRIMARY KEY);
    CREATE TABLE design_files (
      id TEXT PRIMARY KEY,
      design_id TEXT NOT NULL,
      content TEXT NOT NULL,
      file_type TEXT NOT NULL
    );
    CREATE TABLE design_visual_edit_snapshots (
      design_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      html TEXT NOT NULL,
      blob_handle TEXT,
      capture_revision BIGINT NOT NULL DEFAULT 0,
      published_revision BIGINT NOT NULL DEFAULT 0,
      updated_at TEXT,
      visibility TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      PRIMARY KEY (design_id, file_id)
    );
    INSERT INTO design_files (id, design_id, content, file_type)
    VALUES ('screen-one', 'design-one', 'http://localhost:5173/', 'html');
  `);
  localDb.pglite = pglite;
  const schema = { designs, designFiles, designVisualEditSnapshots };
  return { getDb: () => drizzle(pglite, { schema }), schema };
});

import publishSnapshotAction from "./publish-visual-edit-snapshot.js";
import reserveSnapshotAction from "./reserve-visual-edit-snapshot.js";

const design = {
  id: "design-one",
  ownerEmail: "owner@example.test",
  orgId: null,
  visibility: "private",
  data: JSON.stringify({
    sourceType: "localhost",
    screenMetadata: {
      "screen-one": {
        sourceType: "localhost",
        url: "http://localhost:5173/",
      },
    },
  }),
};

function context() {
  return { caller: "frontend" as const, requestHeaders: new Headers() };
}

beforeEach(async () => {
  localDb.assertAccess.mockReset();
  localDb.assertAccess.mockResolvedValue({ role: "owner", resource: design });
  localDb.putPrivateBlob.mockReset();
  localDb.deletePrivateBlob.mockReset();
  localDb.deletePrivateBlob.mockResolvedValue({ deleted: true });
  await localDb.pglite?.query("DELETE FROM design_visual_edit_snapshots");
});

afterAll(async () => {
  await localDb.pglite?.close();
});

describe("visual-edit snapshot reservation ordering", () => {
  it("assigns distinct increasing tokens when owner tabs reserve concurrently", async () => {
    const input = { designId: "design-one", fileId: "screen-one" };
    const reservations = await Promise.all([
      reserveSnapshotAction.run(input, context()),
      reserveSnapshotAction.run(input, context()),
    ]);

    expect(reservations.map((item) => item.reservationToken).sort()).toEqual([
      "1",
      "2",
    ]);
    const [row] =
      (
        await localDb.pglite?.query(
          "SELECT html, blob_handle, capture_revision, published_revision FROM design_visual_edit_snapshots WHERE design_id = $1 AND file_id = $2",
          ["design-one", "screen-one"],
        )
      )?.rows ?? [];
    expect(row).toEqual({
      html: "",
      blob_handle: null,
      capture_revision: 2,
      published_revision: 0,
    });
  });

  it("keeps a newer capture when an older tab finishes uploading later", async () => {
    const olderBlob = {
      id: "older-opaque-example",
      provider: "test-private-provider",
      opaque: true as const,
      encrypted: true,
    };
    const newerBlob = {
      id: "newer-opaque-example",
      provider: "test-private-provider",
      opaque: true as const,
      encrypted: true,
    };
    let releaseOlderUpload!: (blob: typeof olderBlob) => void;
    let signalOlderStarted!: () => void;
    const olderUploadStarted = new Promise<void>((resolve) => {
      signalOlderStarted = resolve;
    });
    const olderUpload = new Promise<typeof olderBlob>((resolve) => {
      releaseOlderUpload = resolve;
    });
    localDb.putPrivateBlob.mockImplementation(async ({ data }) => {
      const capturedHtml = Buffer.from(data).toString("utf8");
      if (capturedHtml.includes("Older capture")) {
        signalOlderStarted();
        return olderUpload;
      }
      return newerBlob;
    });

    const first = await reserveSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    expect(first.reservationToken).toBe("1");

    const olderPublish = publishSnapshotAction.run(
      {
        ...first,
        html: "<html><body><main>Older capture</main></body></html>",
      },
      context(),
    );
    await olderUploadStarted;

    const second = await reserveSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    expect(second.reservationToken).toBe("2");

    await expect(
      publishSnapshotAction.run(
        {
          ...second,
          html: "<html><body><main>Newer capture</main></body></html>",
        },
        context(),
      ),
    ).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      published: true,
    });

    releaseOlderUpload(olderBlob);
    await expect(olderPublish).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      published: false,
    });
    expect(localDb.deletePrivateBlob).toHaveBeenCalledWith(olderBlob);

    const [row] =
      (
        await localDb.pglite?.query(
          "SELECT html, blob_handle, capture_revision, published_revision FROM design_visual_edit_snapshots WHERE design_id = $1 AND file_id = $2",
          ["design-one", "screen-one"],
        )
      )?.rows ?? [];
    expect(row).toEqual({
      html: "",
      blob_handle: JSON.stringify(newerBlob),
      capture_revision: 2,
      published_revision: 2,
    });
  });
});
