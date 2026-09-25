// guard:allow-unscoped — raw SQL resets the isolated in-memory PGlite fixture.
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
  readPrivateBlob: vi.fn(),
  assertAccess: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getDb: vi.fn(),
  sourceMutationCalls: [] as string[],
  afterFirstSourceMutationTransaction: null as null | (() => Promise<void>),
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
  readPrivateBlob: localDb.readPrivateBlob,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: localDb.assertAccess,
  currentAccess: () => ({
    authCapability: "capability:visual-edit:design:design-one",
  }),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: localDb.getRequestUserEmail,
}));
vi.mock("../server/source-workspace.js", () => ({
  designSourceMutationLockKey: (designId: string) =>
    `agent-native:design-source:${designId}`,
  lockDesignFilesTable: vi.fn(),
  withDesignSourceMutationTransaction: async <T>(
    designId: string,
    callback: (tx: unknown) => Promise<T>,
  ) => {
    localDb.sourceMutationCalls.push(designId);
    const { sql } = await import("drizzle-orm");
    const result = await localDb.getDb().transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-native:design-source:${designId}`}, 0::bigint))`,
      );
      return callback(tx);
    });
    if (localDb.afterFirstSourceMutationTransaction) {
      const afterTransaction = localDb.afterFirstSourceMutationTransaction;
      localDb.afterFirstSourceMutationTransaction = null;
      await afterTransaction();
    }
    return result;
  },
  withDesignSourceReadTransaction: async <T>(
    designId: string,
    callback: (tx: unknown) => Promise<T>,
  ) => {
    localDb.sourceMutationCalls.push(designId);
    const { sql } = await import("drizzle-orm");
    const result = await localDb.getDb().transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${`agent-native:design-source:${designId}`}, 0::bigint))`,
      );
      return callback(tx);
    });
    if (localDb.afterFirstSourceMutationTransaction) {
      const afterTransaction = localDb.afterFirstSourceMutationTransaction;
      localDb.afterFirstSourceMutationTransaction = null;
      await afterTransaction();
    }
    return result;
  },
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
    data: pgCore.text("data"),
    updatedAt: pgCore.text("updated_at"),
    visibility: pgCore.text("visibility").notNull(),
    ownerEmail: pgCore.text("owner_email").notNull(),
    orgId: pgCore.text("org_id"),
    liveCollaborationEnabled: pgCore
      .boolean("live_collaboration_enabled")
      .notNull()
      .default(false),
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
  const designVisualEditSnapshotBlobCleanup = pgCore.pgTable(
    "design_visual_edit_snapshot_blob_cleanup",
    {
      blobHandle: pgCore.text("blob_handle").primaryKey(),
      createdAt: pgCore.text("created_at").notNull(),
    },
  );
  const pglite = await PGlite.create("memory://");
  await pglite.exec(`
    CREATE TABLE designs (
      id TEXT PRIMARY KEY,
      data TEXT,
      updated_at TEXT,
      visibility TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      live_collaboration_enabled BOOLEAN NOT NULL DEFAULT FALSE
    );
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
    CREATE TABLE design_visual_edit_snapshot_blob_cleanup (
      blob_handle TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO design_files (id, design_id, content, file_type)
    VALUES ('screen-one', 'design-one', 'http://localhost:5173/', 'html');
  `);
  localDb.pglite = pglite;
  const schema = {
    designs,
    designFiles,
    designVisualEditSnapshots,
    designVisualEditSnapshotBlobCleanup,
  };
  const db = drizzle(pglite, { schema });
  localDb.getDb.mockReturnValue(db);
  return { getDb: () => db, schema };
});

import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { deleteVisualEditSnapshotBlobs } from "../server/lib/visual-edit-snapshot-blobs.js";
import { retireVisualEditSnapshotInTransaction } from "../server/lib/visual-edit-snapshot-retirement.js";
import getSnapshotAction from "./get-visual-edit-snapshot.js";
import publishSnapshotAction from "./publish-visual-edit-snapshot.js";
import reserveSnapshotAction from "./reserve-visual-edit-snapshot.js";
import updateCollaborationAction from "./update-visual-edit-collaboration.js";

const design = {
  id: "design-one",
  ownerEmail: "owner@example.test",
  orgId: null,
  visibility: "private",
  liveCollaborationEnabled: true,
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
  localDb.readPrivateBlob.mockReset();
  localDb.readPrivateBlob.mockImplementation(async () => ({
    data: new TextEncoder().encode("<html><body>Shared</body></html>"),
  }));
  localDb.getRequestUserEmail.mockReset();
  localDb.getRequestUserEmail.mockReturnValue("owner@example.test");
  localDb.putPrivateBlob.mockReset();
  localDb.deletePrivateBlob.mockReset();
  localDb.deletePrivateBlob.mockResolvedValue({ deleted: true });
  localDb.sourceMutationCalls.length = 0;
  localDb.afterFirstSourceMutationTransaction = null;
  await localDb.pglite?.query("DELETE FROM designs");
  await localDb.pglite?.query(
    "INSERT INTO designs (id, data, updated_at, visibility, owner_email, org_id, live_collaboration_enabled) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      "design-one",
      design.data,
      "2026-09-24T00:00:00.000Z",
      "private",
      "owner@example.test",
      null,
      true,
    ],
  );
  await localDb.pglite?.query("DELETE FROM design_visual_edit_snapshots");
  await localDb.pglite?.query(
    "DELETE FROM design_visual_edit_snapshot_blob_cleanup",
  );
});

afterAll(async () => {
  await localDb.pglite?.close();
});

describe("visual-edit snapshot reservation ordering", () => {
  it("does not return a legacy inline snapshot when opt-out commits after lookup", async () => {
    await localDb.pglite?.query(
      "INSERT INTO design_visual_edit_snapshots (design_id, file_id, html, capture_revision, published_revision, updated_at, visibility, owner_email, org_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        "design-one",
        "screen-one",
        "<html><body>Legacy shared page</body></html>",
        1,
        1,
        "2026-09-25T00:00:00.000Z",
        "private",
        "owner@example.test",
        null,
      ],
    );
    localDb.afterFirstSourceMutationTransaction = async () => {
      await localDb.pglite?.query(
        "UPDATE designs SET live_collaboration_enabled = FALSE WHERE id = $1",
        ["design-one"],
      );
      await localDb.pglite?.query(
        "UPDATE design_visual_edit_snapshots SET html = '', blob_handle = NULL, capture_revision = capture_revision + 1, published_revision = 0 WHERE design_id = $1",
        ["design-one"],
      );
    };

    await expect(
      getSnapshotAction.run(
        { designId: "design-one", fileId: "screen-one" },
        context(),
      ),
    ).resolves.toMatchObject({
      html: null,
      publishedRevision: null,
      unchanged: false,
    });
    expect(localDb.sourceMutationCalls).toHaveLength(2);
  });

  it("does not return a blob snapshot when opt-out commits during blob I/O", async () => {
    const blob = {
      id: "race-blob",
      provider: "test-private-provider",
      opaque: true,
      encrypted: true,
    };
    await localDb.pglite?.query(
      "INSERT INTO design_visual_edit_snapshots (design_id, file_id, html, blob_handle, capture_revision, published_revision, updated_at, visibility, owner_email, org_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        "design-one",
        "screen-one",
        "",
        JSON.stringify(blob),
        1,
        1,
        "2026-09-25T00:00:00.000Z",
        "private",
        "owner@example.test",
        null,
      ],
    );

    let releaseRead!: () => void;
    let signalReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      signalReadStarted = resolve;
    });
    const blobRead = new Promise<{ data: Uint8Array }>((resolve) => {
      releaseRead = () =>
        resolve({ data: new TextEncoder().encode("<html>stale</html>") });
    });
    localDb.readPrivateBlob.mockImplementationOnce(() => {
      signalReadStarted();
      return blobRead;
    });

    const read = getSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    await readStarted;
    await updateCollaborationAction.run(
      { designId: "design-one", enabled: false },
      context(),
    );
    releaseRead();

    await expect(read).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      html: null,
      updatedAt: null,
      captureRevision: "2",
      publishedRevision: null,
      unchanged: false,
    });
    const { rows } = (await localDb.pglite?.query(
      "SELECT * FROM design_visual_edit_snapshots WHERE design_id = $1",
      ["design-one"],
    )) ?? { rows: [] };
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      html: "",
      blob_handle: null,
      capture_revision: 2,
      published_revision: 0,
    });
    expect(localDb.deletePrivateBlob).toHaveBeenCalledWith(blob);
  });

  it("rejects a publish whose final serialized check follows opt-out", async () => {
    const candidateBlob = {
      id: "candidate-blob",
      provider: "test-private-provider",
      opaque: true as const,
      encrypted: true,
    };
    let releaseUpload!: () => void;
    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    const upload = new Promise<typeof candidateBlob>((resolve) => {
      releaseUpload = () => resolve(candidateBlob);
    });
    localDb.putPrivateBlob.mockImplementationOnce(() => {
      signalUploadStarted();
      return upload;
    });

    const reservation = await reserveSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    const publish = publishSnapshotAction.run(
      {
        ...reservation,
        html: "<html><body>Snapshot</body></html>",
      },
      context(),
    );
    await uploadStarted;
    await updateCollaborationAction.run(
      { designId: "design-one", enabled: false },
      context(),
    );
    releaseUpload();

    await expect(publish).rejects.toMatchObject({
      errorCode: "visual_edit_collaboration_disabled",
    });
    expect(localDb.deletePrivateBlob).toHaveBeenCalledWith(candidateBlob);
    const { rows } = (await localDb.pglite?.query(
      "SELECT * FROM design_visual_edit_snapshots WHERE design_id = $1",
      ["design-one"],
    )) ?? { rows: [] };
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      html: "",
      blob_handle: null,
      capture_revision: 2,
      published_revision: 0,
    });
  });

  it("rejects a pre-opt-out upload after collaboration is re-enabled", async () => {
    const staleBlob = {
      id: "pre-opt-out-blob",
      provider: "test-private-provider",
      opaque: true as const,
      encrypted: true,
    };
    let releaseUpload!: () => void;
    let signalUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      signalUploadStarted = resolve;
    });
    const upload = new Promise<typeof staleBlob>((resolve) => {
      releaseUpload = () => resolve(staleBlob);
    });
    localDb.putPrivateBlob.mockImplementationOnce(() => {
      signalUploadStarted();
      return upload;
    });

    const staleReservation = await reserveSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    const stalePublish = publishSnapshotAction.run(
      {
        ...staleReservation,
        html: "<html><body>Before opt-out</body></html>",
      },
      context(),
    );
    await uploadStarted;

    await updateCollaborationAction.run(
      { designId: "design-one", enabled: false },
      context(),
    );
    await updateCollaborationAction.run(
      { designId: "design-one", enabled: true },
      context(),
    );
    const currentReservation = await reserveSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    expect(currentReservation.reservationToken).toBe("3");

    releaseUpload();
    await expect(stalePublish).resolves.toEqual({
      designId: "design-one",
      fileId: "screen-one",
      published: false,
    });
    expect(localDb.deletePrivateBlob).toHaveBeenCalledWith(staleBlob);
    const { rows } = (await localDb.pglite?.query(
      "SELECT html, blob_handle, capture_revision, published_revision FROM design_visual_edit_snapshots WHERE design_id = $1 AND file_id = $2",
      ["design-one", "screen-one"],
    )) ?? { rows: [] };
    expect(rows).toEqual([
      {
        html: "",
        blob_handle: null,
        capture_revision: 3,
        published_revision: 0,
      },
    ]);
  });

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

  it("retires a generation atomically across a quick switch back to Localhost", async () => {
    const publishedBlob = {
      id: "published-opaque-example",
      provider: "test-private-provider",
      opaque: true as const,
      encrypted: true,
    };
    const delayedBlob = {
      id: "delayed-opaque-example",
      provider: "test-private-provider",
      opaque: true as const,
      encrypted: true,
    };
    let releaseDelayedUpload!: (blob: typeof delayedBlob) => void;
    let signalDelayedStarted!: () => void;
    const delayedUploadStarted = new Promise<void>((resolve) => {
      signalDelayedStarted = resolve;
    });
    const delayedUpload = new Promise<typeof delayedBlob>((resolve) => {
      releaseDelayedUpload = resolve;
    });
    localDb.putPrivateBlob.mockImplementation(async ({ data }) => {
      const html = Buffer.from(data).toString("utf8");
      if (html.includes("Delayed old capture")) {
        signalDelayedStarted();
        return delayedUpload;
      }
      return publishedBlob;
    });

    const first = await reserveSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    await expect(
      publishSnapshotAction.run(
        {
          ...first,
          html: "<html><body><main>Published fallback</main></body></html>",
        },
        context(),
      ),
    ).resolves.toMatchObject({ published: true });

    const staleReservation = await reserveSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    expect(staleReservation.reservationToken).toBe("2");
    const delayedPublish = publishSnapshotAction.run(
      {
        ...staleReservation,
        html: "<html><body><main>Delayed old capture</main></body></html>",
      },
      context(),
    );
    await delayedUploadStarted;

    await mutateDesignData<string | null>({
      designId: "design-one",
      lockSourceMutation: true,
      mutate: (current) => ({
        ...current,
        screenMetadata: {
          "screen-one": { sourceType: "inline", previewState: "static" },
        },
      }),
      isApplied: (data) =>
        (data.screenMetadata as Record<string, { sourceType?: string }>)?.[
          "screen-one"
        ]?.sourceType === "inline",
      mutateInTransaction: (tx, currentData, nextData) =>
        retireVisualEditSnapshotInTransaction({
          tx,
          designId: "design-one",
          fileId: "screen-one",
          currentData,
          nextData,
        }),
      afterCommit: (blobHandle) => deleteVisualEditSnapshotBlobs([blobHandle]),
    });

    await mutateDesignData({
      designId: "design-one",
      lockSourceMutation: true,
      mutate: (current) => ({
        ...current,
        screenMetadata: {
          "screen-one": {
            sourceType: "localhost",
            url: "http://localhost:5173/",
          },
        },
      }),
      isApplied: (data) =>
        (data.screenMetadata as Record<string, { sourceType?: string }>)?.[
          "screen-one"
        ]?.sourceType === "localhost",
    });

    const nextReservation = await reserveSnapshotAction.run(
      { designId: "design-one", fileId: "screen-one" },
      context(),
    );
    expect(nextReservation.reservationToken).toBe("4");

    releaseDelayedUpload(delayedBlob);
    await expect(delayedPublish).resolves.toMatchObject({ published: false });
    expect(localDb.deletePrivateBlob).toHaveBeenCalledWith(publishedBlob);
    expect(localDb.deletePrivateBlob).toHaveBeenCalledWith(delayedBlob);

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
      capture_revision: 4,
      published_revision: 3,
    });
    expect(localDb.sourceMutationCalls).toContain("design-one");
  });
});
