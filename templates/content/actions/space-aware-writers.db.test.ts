import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const actionEffects = vi.hoisted(() => ({
  generationContexts: new Map<string, Record<string, unknown>>(),
  savedCreativeContextMode: "off" as "off" | "auto",
  getGenerationCreativeContext: vi.fn(
    async (
      { artifactId }: { artifactId: string },
      options?: { localOnly?: boolean },
    ) => {
      if (
        actionEffects.savedCreativeContextMode === "auto" &&
        !options?.localOnly
      ) {
        return null;
      }
      return actionEffects.generationContexts.get(artifactId) ?? null;
    },
  ),
  recordGenerationCreativeContext: vi.fn(
    async (input: { artifactId: string } & Record<string, unknown>) => {
      const existing = actionEffects.generationContexts.get(input.artifactId);
      if (input.onlyIfMissing && existing) return existing;
      actionEffects.generationContexts.set(input.artifactId, input);
      return input;
    },
  ),
  validateGenerationCreativeContext: vi.fn(async () => ({
    contextMode: "off" as const,
    contextPackId: null,
    reuseLabels: [],
    results: [],
  })),
  track: vi.fn(),
  writeAppState: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: actionEffects.writeAppState,
}));

vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  track: actionEffects.track,
}));

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: actionEffects.getGenerationCreativeContext,
  recordGenerationCreativeContext:
    actionEffects.recordGenerationCreativeContext,
  validateGenerationCreativeContext:
    actionEffects.validateGenerationCreativeContext,
}));

vi.mock("./_local-file-documents.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./_local-file-documents.js")>();
  return { ...original, isContentLocalFileMode: async () => false };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `space-aware-writers-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createDocument: typeof import("./create-document.js").default;
let createContentDatabase: typeof import("./create-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let organizationContentSpaceId: typeof import("./_content-spaces.js").organizationContentSpaceId;
let personalContentSpaceId: typeof import("./_content-spaces.js").personalContentSpaceId;

const OWNER = "owner@example.com";
const MEMBER = "member@example.com";
const VIEWER = "viewer@example.com";
const OUTSIDER = "outsider@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createDocument = (await import("./create-document.js")).default;
  createContentDatabase = (await import("./create-content-database.js"))
    .default;
  addDatabaseItem = (await import("./add-database-item.js")).default;
  getContentDatabase = (await import("./get-content-database.js")).default;
  ({ organizationContentSpaceId, personalContentSpaceId } =
    await import("./_content-spaces.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function addOrganizationMember(args: {
  orgId: string;
  email: string;
  role?: string;
}) {
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
    args: [args.orgId, "Shared workspace", OWNER, Date.now()],
  });
  await getDbExec().execute({
    sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
    args: [
      `${args.orgId}:${args.email}`,
      args.orgId,
      args.email,
      args.role ?? "member",
      Date.now(),
    ],
  });
}

async function filesMemberships(documentId: string) {
  return getDb()
    .select({
      itemId: schema.contentDatabaseItems.id,
      databaseId: schema.contentDatabaseItems.databaseId,
      spaceId: schema.contentDatabases.spaceId,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, documentId),
        eq(schema.contentDatabases.systemRole, "files"),
      ),
    );
}

describe("space-aware document writers", () => {
  it("rejects an empty caller-provided database document ID", async () => {
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        createContentDatabase.run({ newDocumentId: "" }),
      ),
    ).rejects.toThrow();
  });

  it("defaults root pages to personal Files and keeps nested pages in the parent space", async () => {
    const parent = await runWithRequestContext({ userEmail: OWNER }, () =>
      createDocument.run({ title: "Parent" }),
    );
    const child = await runWithRequestContext({ userEmail: OWNER }, () =>
      createDocument.run({ title: "Child", parentId: parent.id }),
    );

    const rows = await getDb()
      .select({
        id: schema.documents.id,
        spaceId: schema.documents.spaceId,
        createdBy: schema.documents.createdBy,
        updatedBy: schema.documents.updatedBy,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, child.id));
    expect(rows[0]?.spaceId).toBeTruthy();
    expect(rows[0]).toMatchObject({ createdBy: OWNER, updatedBy: OWNER });
    await expect(filesMemberships(parent.id)).resolves.toHaveLength(1);
    await expect(filesMemberships(child.id)).resolves.toEqual([
      expect.objectContaining({ spaceId: rows[0]?.spaceId }),
    ]);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        createDocument.run({
          title: "Wrong space",
          parentId: parent.id,
          spaceId: "content_space_elsewhere",
        }),
      ),
    ).rejects.toThrow("parent Content space");
  });

  it("replays a committed optimistic page create without duplicating creation effects", async () => {
    const parent = await runWithRequestContext({ userEmail: OWNER }, () =>
      createDocument.run({ title: "Retry parent" }),
    );
    await getDb().insert(schema.documentShares).values({
      id: "retry-parent-member-share",
      resourceId: parent.id,
      principalType: "user",
      principalId: MEMBER,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });

    const input = {
      id: "optimistic-create-retry",
      title: "Original title",
      content: "Original body",
      description: "Original description",
      parentId: parent.id,
      contextModeOverride: "off" as const,
    };
    actionEffects.recordGenerationCreativeContext.mockClear();
    actionEffects.track.mockClear();
    actionEffects.writeAppState.mockClear();
    actionEffects.writeAppState.mockRejectedValueOnce(
      new Error("refresh signal unavailable"),
    );

    const create = () =>
      runWithRequestContext({ userEmail: MEMBER }, () =>
        createDocument.run(input),
      );
    await expect(create()).rejects.toThrow("refresh signal unavailable");

    const [createdRow] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, input.id));
    expect(createdRow).toMatchObject({
      id: input.id,
      title: input.title,
      content: input.content,
      ownerEmail: OWNER,
      parentId: parent.id,
      createdBy: MEMBER,
      creationRequestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    await getDb()
      .update(schema.documents)
      .set({ title: "Edited title", content: "Typed after create" })
      .where(eq(schema.documents.id, input.id));

    await getDb()
      .update(schema.documentShares)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.documentShares.resourceId, parent.id),
          eq(schema.documentShares.principalId, MEMBER),
        ),
      );
    await getDb()
      .update(schema.documentShares)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.documentShares.resourceId, input.id),
          eq(schema.documentShares.principalId, MEMBER),
        ),
      );

    const replayed = await create();
    expect(replayed).toMatchObject({
      id: input.id,
      title: "Edited title",
      content: "Typed after create",
      accessRole: "viewer",
      canEdit: false,
      canManage: false,
    });
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, input.id)),
    ).resolves.toHaveLength(1);
    await expect(filesMemberships(input.id)).resolves.toHaveLength(1);
    await expect(
      getDb()
        .select()
        .from(schema.documentShares)
        .where(eq(schema.documentShares.resourceId, input.id)),
    ).resolves.toHaveLength(1);
    expect(actionEffects.writeAppState).toHaveBeenCalledTimes(2);
    expect(actionEffects.recordGenerationCreativeContext).toHaveBeenCalledTimes(
      2,
    );
    expect(
      actionEffects.recordGenerationCreativeContext,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextMode: "off",
        contextPackId: null,
        reuseLabels: [],
        elementProvenance: [],
        onlyIfMissing: true,
      }),
    );
    expect(actionEffects.track).toHaveBeenCalledTimes(1);
    expect(
      actionEffects.validateGenerationCreativeContext,
    ).toHaveBeenCalledTimes(1);

    const conflicts = [
      () =>
        runWithRequestContext({ userEmail: MEMBER }, () =>
          createDocument.run({ ...input, title: "Different original title" }),
        ),
      () =>
        runWithRequestContext({ userEmail: MEMBER }, () =>
          createDocument.run({ ...input, spaceId: "different-space" }),
        ),
      () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          createDocument.run(input),
        ),
    ];
    for (const conflict of conflicts) {
      await expect(conflict()).rejects.toMatchObject({
        errorCode: "DOCUMENT_ID_CONFLICT",
        statusCode: 409,
        message: "This document ID is already in use.",
      });
    }
    expect(actionEffects.writeAppState).toHaveBeenCalledTimes(2);
    expect(actionEffects.recordGenerationCreativeContext).toHaveBeenCalledTimes(
      2,
    );
    expect(actionEffects.track).toHaveBeenCalledTimes(1);
  });

  it("repairs a committed creation provenance projection on replay", async () => {
    const input = {
      id: "optimistic-create-provenance-retry",
      title: "Provenance retry",
      content: "Body",
      contextModeOverride: "off" as const,
    };
    actionEffects.generationContexts.delete(input.id);
    actionEffects.getGenerationCreativeContext.mockClear();
    actionEffects.recordGenerationCreativeContext.mockClear();
    actionEffects.validateGenerationCreativeContext.mockClear();
    actionEffects.track.mockClear();
    actionEffects.writeAppState.mockClear();
    const recordGeneration =
      actionEffects.recordGenerationCreativeContext.getMockImplementation();
    actionEffects.recordGenerationCreativeContext.mockImplementationOnce(
      async (record) => {
        await recordGeneration?.(record);
        throw new Error("projection store unavailable");
      },
    );

    const create = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        createDocument.run(input),
      );

    await expect(create()).rejects.toThrow("projection store unavailable");
    expect(actionEffects.generationContexts.get(input.id)).toMatchObject({
      contextMode: "off",
      contextPackId: null,
    });

    actionEffects.validateGenerationCreativeContext.mockClear();
    const replayed = await create();
    expect(replayed).toMatchObject({ id: input.id, title: input.title });
    expect(
      actionEffects.validateGenerationCreativeContext,
    ).not.toHaveBeenCalled();
    expect(actionEffects.getGenerationCreativeContext).toHaveBeenCalledTimes(1);
    expect(actionEffects.recordGenerationCreativeContext).toHaveBeenCalledTimes(
      2,
    );
    expect(
      actionEffects.recordGenerationCreativeContext,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ onlyIfMissing: true }),
    );
    expect(
      actionEffects.recordGenerationCreativeContext,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextMode: "off",
        contextPackId: null,
        reuseLabels: [],
        elementProvenance: [],
        onlyIfMissing: true,
      }),
    );
    expect(actionEffects.generationContexts.has(input.id)).toBe(true);
    expect(actionEffects.track).toHaveBeenCalledTimes(1);
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, input.id)),
    ).resolves.toHaveLength(1);
  });

  it("repairs explicit off provenance locally after the saved mode changes", async () => {
    const input = {
      id: "optimistic-create-context-off-local-replay",
      title: "Local context repair",
      contextModeOverride: "off" as const,
    };
    actionEffects.savedCreativeContextMode = "auto";
    actionEffects.generationContexts.delete(input.id);
    actionEffects.getGenerationCreativeContext.mockClear();
    actionEffects.recordGenerationCreativeContext.mockClear();
    actionEffects.validateGenerationCreativeContext.mockClear();
    const recordGeneration =
      actionEffects.recordGenerationCreativeContext.getMockImplementation();
    actionEffects.recordGenerationCreativeContext.mockImplementationOnce(
      async (record) => {
        await recordGeneration?.(record);
        throw new Error("projection store unavailable");
      },
    );

    const create = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        createDocument.run(input),
      );

    try {
      await expect(create()).rejects.toThrow("projection store unavailable");
      actionEffects.getGenerationCreativeContext.mockClear();
      actionEffects.recordGenerationCreativeContext.mockClear();
      actionEffects.validateGenerationCreativeContext.mockClear();

      await expect(create()).resolves.toMatchObject({
        id: input.id,
        contextMode: "off",
        contextPackId: null,
      });
      expect(actionEffects.getGenerationCreativeContext).toHaveBeenCalledWith(
        expect.objectContaining({ artifactId: input.id }),
        { localOnly: true },
      );
      expect(
        actionEffects.recordGenerationCreativeContext,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          contextMode: "off",
          contextPackId: null,
          onlyIfMissing: true,
        }),
      );
      expect(
        actionEffects.validateGenerationCreativeContext,
      ).not.toHaveBeenCalled();
    } finally {
      actionEffects.savedCreativeContextMode = "off";
    }
  });

  it("uses persisted Creative Context when settings or pack access change before replay", async () => {
    const input = {
      id: "optimistic-create-context-access-replay",
      title: "Context access retry",
      contextPackId: "context-pack-revoked-after-create",
    };
    const reuseLabel = {
      itemId: "context-item",
      itemVersionId: "context-item-version",
      kind: "brand-voice",
      label: "Brand voice",
      dataRole: "untrusted-reference" as const,
      influence: "reference-conditioned" as const,
    };
    actionEffects.generationContexts.delete(input.id);
    actionEffects.getGenerationCreativeContext.mockClear();
    actionEffects.recordGenerationCreativeContext.mockClear();
    actionEffects.validateGenerationCreativeContext.mockResolvedValueOnce({
      contextMode: "pinned",
      contextPackId: input.contextPackId,
      reuseLabels: [reuseLabel],
      results: [],
    });

    const create = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        createDocument.run(input),
      );
    await expect(create()).resolves.toMatchObject({
      id: input.id,
      contextMode: "pinned",
      contextPackId: input.contextPackId,
    });
    expect(
      actionEffects.validateGenerationCreativeContext,
    ).toHaveBeenCalledTimes(1);

    const persistedContext = actionEffects.generationContexts.get(input.id);
    expect(persistedContext).toMatchObject({
      contextMode: "pinned",
      contextPackId: input.contextPackId,
    });

    actionEffects.validateGenerationCreativeContext.mockClear();
    actionEffects.validateGenerationCreativeContext.mockImplementation(() => {
      throw new Error("current pack access was revoked");
    });
    await expect(create()).resolves.toMatchObject({
      id: input.id,
      contextMode: "pinned",
      contextPackId: input.contextPackId,
    });
    expect(
      actionEffects.validateGenerationCreativeContext,
    ).not.toHaveBeenCalled();
    expect(actionEffects.generationContexts.get(input.id)).toMatchObject({
      contextMode: "pinned",
      contextPackId: input.contextPackId,
    });
    expect(actionEffects.recordGenerationCreativeContext).toHaveBeenCalledTimes(
      2,
    );
    expect(
      actionEffects.recordGenerationCreativeContext,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contextMode: "auto",
        contextPackId: null,
        reuseLabels: [],
        elementProvenance: [],
        onlyIfMissing: true,
      }),
    );

    actionEffects.validateGenerationCreativeContext.mockImplementation(
      async () => ({
        contextMode: "off",
        contextPackId: null,
        reuseLabels: [],
        results: [],
      }),
    );
  });

  it("lets ordinary organization members create root pages and databases while guests remain read-only", async () => {
    const orgId = "org-shared-writers";
    await addOrganizationMember({ orgId, email: MEMBER });
    await addOrganizationMember({ orgId, email: VIEWER, role: "guest" });
    const spaceId = organizationContentSpaceId(orgId);
    const created = await runWithRequestContext(
      { userEmail: MEMBER, orgId },
      () => createDocument.run({ title: "Member page", spaceId }),
    );

    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, created.id));
    expect(document).toMatchObject({
      spaceId,
      ownerEmail: MEMBER,
      orgId,
      visibility: "org",
    });
    await expect(filesMemberships(created.id)).resolves.toHaveLength(1);

    const [filesDatabase] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.spaceId, spaceId),
          eq(schema.contentDatabases.systemRole, "files"),
        ),
      );
    const viaFilesTarget = await runWithRequestContext(
      { userEmail: MEMBER, orgId },
      () =>
        createDocument.run({
          title: "Member page via Files target",
          parentId: filesDatabase.documentId,
        }),
    );
    const [viaFilesTargetRow] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, viaFilesTarget.id));
    expect(viaFilesTargetRow).toMatchObject({
      spaceId,
      parentId: null,
      ownerEmail: MEMBER,
      orgId,
      visibility: "org",
    });

    const viaAgreeingTargets = await runWithRequestContext(
      { userEmail: MEMBER, orgId },
      () =>
        createDocument.run({
          title: "Member page via agreeing targets",
          parentId: filesDatabase.documentId,
          spaceId,
        }),
    );
    expect(viaAgreeingTargets).toMatchObject({ spaceId, parentId: null });

    await expect(
      runWithRequestContext({ userEmail: MEMBER, orgId }, () =>
        createDocument.run({
          id: "rejected-conflicting-files-target",
          title: "Conflicting Files target",
          parentId: filesDatabase.documentId,
          spaceId: personalContentSpaceId(MEMBER),
        }),
      ),
    ).rejects.toThrow("same Content space");
    await getDb().insert(schema.documentShares).values({
      id: "guest-files-editor-share",
      resourceId: filesDatabase.documentId,
      principalType: "user",
      principalId: VIEWER,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
    const guestAttempt = async (parentId: string, id: string) => {
      try {
        await runWithRequestContext({ userEmail: VIEWER, orgId }, () =>
          createDocument.run({ title: id, id, parentId }),
        );
        return null;
      } catch (error) {
        return {
          name: error instanceof Error ? error.name : typeof error,
          message: (error instanceof Error
            ? error.message
            : String(error)
          ).replace(parentId, "<parentId>"),
        };
      }
    };
    const guestRealFilesError = await guestAttempt(
      filesDatabase.documentId,
      "rejected-guest-files-target",
    );
    const guestFakeFilesError = await guestAttempt(
      "content_document_files_guest-not-real",
      "rejected-guest-fake-files-target",
    );
    expect(guestRealFilesError).not.toBeNull();
    expect(guestRealFilesError).toEqual(guestFakeFilesError);
    await expect(
      runWithRequestContext({ userEmail: VIEWER, orgId }, () =>
        createDocument.run({
          id: "rejected-guest-child",
          title: "Guest child page",
          parentId: created.id,
        }),
      ),
    ).rejects.toThrow("Requires editor role");
    await expect(
      runWithRequestContext({ userEmail: MEMBER, orgId }, () =>
        createDocument.run({
          id: "rejected-fake-files-target",
          title: "Fake Files target",
          parentId: "content_document_files_not-real",
        }),
      ),
    ).rejects.toThrow();

    const outsiderPersonal = await runWithRequestContext(
      { userEmail: OUTSIDER },
      () => createDocument.run({ title: "Outsider personal setup" }),
    );
    const outsiderAttempt = async (parentId: string, id: string) => {
      try {
        await runWithRequestContext({ userEmail: OUTSIDER }, () =>
          createDocument.run({
            id,
            title: id,
            parentId,
            spaceId: outsiderPersonal.spaceId,
          }),
        );
        return null;
      } catch (error) {
        return {
          name: error instanceof Error ? error.name : typeof error,
          message: (error instanceof Error
            ? error.message
            : String(error)
          ).replace(parentId, "<parentId>"),
        };
      }
    };
    const outsiderRealFilesError = await outsiderAttempt(
      filesDatabase.documentId,
      "rejected-outsider-real-files",
    );
    const outsiderFakeFilesError = await outsiderAttempt(
      "content_document_files_not-real",
      "rejected-outsider-fake-files",
    );
    expect(outsiderRealFilesError).not.toBeNull();
    expect(outsiderRealFilesError).toEqual(outsiderFakeFilesError);

    const rejectedIds = [
      "rejected-conflicting-files-target",
      "rejected-guest-files-target",
      "rejected-guest-fake-files-target",
      "rejected-guest-child",
      "rejected-fake-files-target",
      "rejected-outsider-real-files",
      "rejected-outsider-fake-files",
    ];
    const rejectedDocuments = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(inArray(schema.documents.id, rejectedIds));
    expect(rejectedDocuments).toEqual([]);

    const createdDatabase = await runWithRequestContext(
      { userEmail: MEMBER, orgId },
      () =>
        createContentDatabase.run({
          newDocumentId: "member-database-document",
          title: "Member database",
          spaceId,
        }),
    );
    expect(createdDatabase.database.documentId).toBe(
      "member-database-document",
    );
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, createdDatabase.database.id));
    expect(database).toMatchObject({ spaceId, ownerEmail: MEMBER, orgId });
    await expect(
      filesMemberships(createdDatabase.database.documentId),
    ).resolves.toHaveLength(1);

    await expect(
      runWithRequestContext({ userEmail: VIEWER, orgId }, () =>
        createDocument.run({ title: "Viewer page", spaceId }),
      ),
    ).rejects.toThrow("Contributor access is required");
    await expect(
      runWithRequestContext({ userEmail: VIEWER, orgId }, () =>
        createContentDatabase.run({ title: "Viewer database", spaceId }),
      ),
    ).rejects.toThrow("Contributor access is required");
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER }, () =>
        createDocument.run({ title: "No entry", spaceId }),
      ),
    ).rejects.toThrow("Content space not found");
  });

  it("creates canonical Files memberships when the target organization differs from the active organization", async () => {
    const activeOrgId = "org-active-writers";
    const targetOrgId = "org-target-writers";
    await addOrganizationMember({
      orgId: activeOrgId,
      email: MEMBER,
      role: "admin",
    });
    await addOrganizationMember({
      orgId: targetOrgId,
      email: MEMBER,
      role: "admin",
    });
    const targetSpaceId = organizationContentSpaceId(targetOrgId);

    const page = await runWithRequestContext(
      { userEmail: MEMBER, orgId: activeOrgId },
      () =>
        createDocument.run({
          title: "Cross-organization page",
          spaceId: targetSpaceId,
        }),
    );
    await expect(filesMemberships(page.id)).resolves.toEqual([
      expect.objectContaining({ spaceId: targetSpaceId }),
    ]);

    const createdDatabase = await runWithRequestContext(
      { userEmail: MEMBER, orgId: activeOrgId },
      () =>
        createContentDatabase.run({
          title: "Cross-organization database",
          spaceId: targetSpaceId,
        }),
    );
    await expect(
      filesMemberships(createdDatabase.database.documentId),
    ).resolves.toEqual([expect.objectContaining({ spaceId: targetSpaceId })]);
  });

  it("keeps databases and their rows in one space and repairs converted page membership", async () => {
    const page = await runWithRequestContext({ userEmail: OWNER }, () =>
      createDocument.run({ title: "Convert me" }),
    );
    const [pageRow] = await getDb()
      .select({ spaceId: schema.documents.spaceId })
      .from(schema.documents)
      .where(eq(schema.documents.id, page.id));
    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.documentId, page.id));

    const converted = await runWithRequestContext({ userEmail: OWNER }, () =>
      createContentDatabase.run({ documentId: page.id }),
    );
    const [databaseRow] = await getDb()
      .select({ spaceId: schema.contentDatabases.spaceId })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, converted.database.id));
    expect(databaseRow?.spaceId).toBe(pageRow?.spaceId);
    await expect(filesMemberships(page.id)).resolves.toHaveLength(1);

    const discovered = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabase.run({ databaseId: converted.database.id }),
    );
    if (!("database" in discovered) || !discovered.mutationContract)
      throw new Error("Fixture database has no mutation contract.");
    const row = await runWithRequestContext({ userEmail: OWNER }, () =>
      addDatabaseItem.run({
        target: discovered.mutationContract!.target,
        expectedSchemaRevision: discovered.mutationContract!.schemaRevision,
        idempotencyKey: "space-aware-row",
        title: "Database row",
      }),
    );
    const [rowDocument] = await getDb()
      .select({ spaceId: schema.documents.spaceId })
      .from(schema.documents)
      .where(eq(schema.documents.id, row.receipt.row.documentId));
    expect(rowDocument?.spaceId).toBe(pageRow?.spaceId);
    await expect(
      filesMemberships(row.receipt.row.documentId),
    ).resolves.toHaveLength(1);
  });

  it("rejects database row creation when a legacy database has no Content space", async () => {
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "legacy-unscoped-database-document",
      ownerEmail: OWNER,
      orgId: null,
      spaceId: null,
      parentId: null,
      title: "Legacy unscoped database",
      content: "",
      position: 0,
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: "legacy-unscoped-database",
      ownerEmail: OWNER,
      orgId: null,
      spaceId: null,
      documentId: "legacy-unscoped-database-document",
      title: "Legacy unscoped database",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        addDatabaseItem.run({
          target: {
            authorityScope: { kind: "personal", id: OWNER },
            spaceId: "fixture-space",
            databaseId: "legacy-unscoped-database",
            databaseDocumentId: "legacy-unscoped-database-document",
          },
          expectedSchemaRevision: "sha256:fixture",
          idempotencyKey: "legacy-unscoped-database",
          title: "Must not be created",
        }),
      ),
    ).rejects.toThrow("does not belong to a Content space");
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(
          eq(schema.documents.parentId, "legacy-unscoped-database-document"),
        ),
    ).resolves.toHaveLength(0);
  });
});
