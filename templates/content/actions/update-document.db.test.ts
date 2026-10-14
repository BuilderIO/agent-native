import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseIconValue } from "@agent-native/core/icons";
import { runWithRequestContext } from "@agent-native/core/server";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createAuthoredContentBase } from "../app/components/editor/authored-content-base";

const { outcomeCounter } = vi.hoisted(() => ({ outcomeCounter: vi.fn() }));
vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  countOutcome: outcomeCounter,
}));

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `update-document-cas-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let updateDocumentAction: typeof import("./update-document.js").default;
let getDocumentSaveAttemptAction: typeof import("./get-document-save-attempt.js").default;
let updatePersonalViewAction: typeof import("./update-content-database-personal-view.js").default;
let editDocumentAction: typeof import("./edit-document.js").default;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const VIEWER = "viewer@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  updateDocumentAction = (await import("./update-document.js")).default;
  getDocumentSaveAttemptAction = (
    await import("./get-document-save-attempt.js")
  ).default;
  updatePersonalViewAction = (
    await import("./update-content-database-personal-view.js")
  ).default;
  editDocumentAction = (await import("./edit-document.js")).default;
  ({ documentRevisionToken } = await import("./_document-edit-mutation.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createDocument(args: {
  id?: string;
  title?: string;
  content?: string;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = args.id ?? nextId("doc");
  await db.insert(schema.documents).values({
    id,
    ownerEmail: args.ownerEmail ?? OWNER,
    parentId: null,
    title: args.title ?? "Untitled",
    content: args.content ?? "",
    position: 0,
    visibility: "private",
    orgId: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function documentRow(documentId: string) {
  const db = getDb();
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  return document;
}

async function measuredSave<T>(
  save: () => Promise<T>,
  expected: Record<string, unknown>,
) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  outcomeCounter.mockClear();
  const result = await save();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(outcomeCounter).toHaveBeenCalledExactlyOnceWith(
    "content_save_outcome_counts",
    expect.objectContaining({ operation: "update_document", ...expected }),
  );
  return result;
}

describe("update-document compare-and-swap", () => {
  it.each(["no-op", "membership", "sidebar"] as const)(
    "reports %s favorite changes truthfully when access disappears after unpin",
    async (changeKind) => {
      const { getUserSetting, putUserSetting } =
        await import("@agent-native/core/settings");
      const { ForbiddenError } = await import("@agent-native/core/sharing");
      const { favoritesSystemIds, favoriteMembershipId, favoriteDocumentIds } =
        await import("./_content-favorites.js");
      const { personalDatabaseViewSettingKey } =
        await import("./_content-database-personal-view.js");
      const settings = await import("./_user-setting-transaction.js");
      const mutateSetting = settings.mutateContentUserSettingTransaction;
      const id = await createDocument({ title: "Unpin race" });
      const db = getDb();
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({
          id,
          isFavorite: changeKind === "membership",
        }),
      );
      const settingKey = personalDatabaseViewSettingKey(
        favoritesSystemIds(OWNER).databaseId,
      );
      const membershipId = favoriteMembershipId(OWNER, id);
      if (changeKind === "sidebar") {
        const current = await getUserSetting(OWNER, settingKey);
        await putUserSetting(OWNER, settingKey, {
          ...current,
          views: (current!.views as any[]).map((view) => ({
            ...view,
            sidebarOrder: {
              ...view.sidebarOrder,
              itemIds: [membershipId, ...view.sidebarOrder.itemIds],
            },
          })),
        });
      }
      const race = vi
        .spyOn(settings, "mutateContentUserSettingTransaction")
        .mockImplementationOnce(async (...args) => {
          const result = await mutateSetting(...args);
          expect((await favoriteDocumentIds(db, OWNER, [id])).size).toBe(0);
          const current = await getUserSetting(OWNER, settingKey);
          expect(
            (current!.views as any[])[0].sidebarOrder.itemIds,
          ).not.toContain(membershipId);
          await db
            .update(schema.documents)
            .set({ ownerEmail: "new-owner@example.com" })
            .where(eq(schema.documents.id, id));
          return result;
        });
      try {
        const save = () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run({ id, isFavorite: false }),
          );
        if (changeKind === "no-op") {
          await expect(save()).rejects.toBeInstanceOf(ForbiddenError);
        } else {
          await expect(save()).rejects.toMatchObject({
            errorCode: "DOCUMENT_SAVED_ACCESS_CHANGED",
            statusCode: 403,
            details: { id, saved: true },
          });
        }
        expect(race).toHaveBeenCalledOnce();
      } finally {
        race.mockRestore();
      }
    },
  );

  it.each(["owner", "viewer", "revoked", "deleted"] as const)(
    "refreshes %s access after the early receipt lookup races with a move",
    async (accessAfterMove) => {
      const id = await createDocument({ content: "Body" });
      const db = getDb();
      await db.insert(schema.documentShares).values({
        id: nextId("receipt-race-share"),
        resourceId: id,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
      const args = {
        id,
        title: "Saved title",
        baseTitle: "Untitled",
        browserSaveAttemptId: nextId("receipt-race-attempt"),
      };
      const save = () =>
        runWithRequestContext({ userEmail: EDITOR }, () =>
          updateDocumentAction.run(args, {
            caller: "frontend",
            userEmail: EDITOR,
          }),
        );
      await expect(save()).resolves.toMatchObject({
        browserSaveAttempt: { result: "applied" },
      });
      const attempts = await import("./_browser-document-save-attempt.js");
      const lookup = attempts.findBrowserSaveAttempt;
      const race = vi
        .spyOn(attempts, "findBrowserSaveAttempt")
        .mockImplementationOnce(async (input) => {
          const receipt = await lookup(input);
          expect(receipt).not.toBeNull();
          await db
            .delete(schema.documentShares)
            .where(eq(schema.documentShares.resourceId, id));
          if (accessAfterMove === "deleted") {
            await db
              .delete(schema.documents)
              .where(eq(schema.documents.id, id));
          } else {
            await db
              .update(schema.documents)
              .set({
                ownerEmail: accessAfterMove === "owner" ? EDITOR : VIEWER,
              })
              .where(eq(schema.documents.id, id));
            if (accessAfterMove === "viewer") {
              await db.insert(schema.documentShares).values({
                id: nextId("receipt-race-viewer-share"),
                resourceId: id,
                principalType: "user",
                principalId: EDITOR,
                role: "viewer",
                createdBy: VIEWER,
                createdAt: new Date().toISOString(),
              });
            }
          }
          return receipt;
        });
      try {
        if (accessAfterMove === "revoked" || accessAfterMove === "deleted") {
          await expect(save()).rejects.toMatchObject({
            statusCode: accessAfterMove === "revoked" ? 403 : 404,
          });
        } else {
          await expect(save()).resolves.toMatchObject({
            id,
            title: "Saved title",
            content: "Body",
            accessRole: accessAfterMove,
            browserSaveAttempt: { result: "replayed" },
          });
        }
        expect(race).toHaveBeenCalledOnce();
      } finally {
        race.mockRestore();
      }
    },
  );

  it.each(
    (["conflict", "preservation", "saved"] as const).flatMap((responseKind) =>
      (["owner", "editor", "viewer", "revoked", "deleted"] as const).map(
        (accessAfterMove) => [responseKind, accessAfterMove] as const,
      ),
    ),
  )(
    "refreshes a %s response after a move leaves %s access",
    async (responseKind, accessAfterMove) => {
      const id = await createDocument({ content: "Original" });
      const db = getDb();
      await db.insert(schema.documentShares).values({
        id: nextId("moving-share"),
        resourceId: id,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
      const transaction = db.transaction.bind(db);
      const race = vi
        .spyOn(db, "transaction")
        .mockImplementationOnce(async (...args: unknown[]) => {
          const result = await transaction(...args);
          if (responseKind === "saved") {
            expect(await documentRow(id)).toMatchObject({
              title: "Saved title",
            });
          }
          await db
            .delete(schema.documentShares)
            .where(eq(schema.documentShares.resourceId, id));
          if (accessAfterMove === "deleted") {
            await db
              .delete(schema.documents)
              .where(eq(schema.documents.id, id));
          } else {
            await db
              .update(schema.documents)
              .set({
                ownerEmail: accessAfterMove === "owner" ? EDITOR : VIEWER,
              })
              .where(eq(schema.documents.id, id));
            if (accessAfterMove === "editor" || accessAfterMove === "viewer") {
              await db.insert(schema.documentShares).values({
                id: nextId("moved-share"),
                resourceId: id,
                principalType: "user",
                principalId: EDITOR,
                role: accessAfterMove,
                createdBy: VIEWER,
                createdAt: new Date().toISOString(),
              });
            }
          }
          return result;
        });
      try {
        const save = () =>
          runWithRequestContext({ userEmail: EDITOR }, () =>
            updateDocumentAction.run(
              responseKind === "saved"
                ? { id, title: "Saved title" }
                : {
                    id,
                    content: "Must not apply",
                    baseRevision: documentRevisionToken(0, "Stale base"),
                    ...(responseKind === "conflict"
                      ? {
                          recoveryExpectedUpdatedAt: "1970-01-01T00:00:00.000Z",
                        }
                      : {}),
                  },
              {
                caller: "frontend",
                actionName: "update-document",
                userEmail: EDITOR,
              },
            ),
          );
        if (
          responseKind === "saved" &&
          (accessAfterMove === "revoked" || accessAfterMove === "deleted")
        ) {
          await expect(save()).rejects.toMatchObject({
            errorCode: "DOCUMENT_SAVED_ACCESS_CHANGED",
            statusCode: accessAfterMove === "revoked" ? 403 : 404,
            details: { id, saved: true },
            message: expect.stringContaining("update was saved"),
          });
        } else if (accessAfterMove === "revoked") {
          await expect(save()).rejects.toMatchObject({ statusCode: 403 });
        } else if (accessAfterMove === "deleted") {
          await expect(save()).rejects.toMatchObject({
            errorCode: "DOCUMENT_NOT_FOUND",
            statusCode: 404,
          });
        } else {
          await expect(save()).resolves.toMatchObject(
            responseKind === "saved"
              ? {
                  id,
                  title: "Saved title",
                  content: "Original",
                  accessRole: accessAfterMove,
                }
              : {
                  [responseKind === "conflict"
                    ? "conflict"
                    : "preservationRequired"]: true,
                  document: {
                    id,
                    content: "Original",
                    accessRole: accessAfterMove,
                  },
                },
          );
          if (responseKind === "preservation") {
            const { queryAuditEvents } =
              await import("@agent-native/core/audit");
            const events = await queryAuditEvents(
              { userEmail: OWNER },
              {
                action: "update-document",
                targetType: "document",
                targetId: id,
              },
            );
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
              ownerEmail: OWNER,
              actorEmail: EDITOR,
              status: "success",
            });
          }
        }
        if (responseKind === "saved") {
          const { queryAuditEvents } = await import("@agent-native/core/audit");
          const events = await queryAuditEvents(
            { userEmail: OWNER },
            { action: "update-document", targetType: "document", targetId: id },
          );
          expect(events).toHaveLength(1);
          expect(events[0]).toMatchObject({
            ownerEmail: OWNER,
            actorEmail: EDITOR,
            status: "success",
            errorCode:
              accessAfterMove === "revoked" || accessAfterMove === "deleted"
                ? "DOCUMENT_SAVED_ACCESS_CHANGED"
                : null,
          });
        }
        expect(race).toHaveBeenCalledOnce();
      } finally {
        race.mockRestore();
      }
    },
  );

  it.each(["locked receipt", "rollback recovery"] as const)(
    "scopes a preservation replay from %s to the current read owner",
    async (replayKind) => {
      const id = await createDocument({ content: "Original" });
      const db = getDb();
      await db.insert(schema.documentShares).values({
        id: nextId("preservation-replay-share"),
        resourceId: id,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
      const args = {
        id,
        content: "Preserved candidate",
        baseRevision: documentRevisionToken(0, "Stale base"),
        browserSaveAttemptId: nextId("preservation-replay-attempt"),
      };
      const preserved = await runWithRequestContext({ userEmail: EDITOR }, () =>
        updateDocumentAction.run(args, {
          caller: "frontend",
          userEmail: EDITOR,
        }),
      );
      expect(preserved).toMatchObject({ preservationRequired: true });
      const attempts = await import("./_browser-document-save-attempt.js");
      const earlyLookup = vi
        .spyOn(attempts, "findBrowserSaveAttempt")
        .mockResolvedValueOnce(null);
      const transaction = db.transaction.bind(db);
      const retryFailure = new Error("Fake aborted preservation retry");
      const race = vi
        .spyOn(db, "transaction")
        .mockImplementationOnce(async (mutate: (tx: any) => Promise<void>) => {
          let result;
          if (replayKind === "locked receipt") {
            result = await transaction(mutate);
          } else {
            try {
              await transaction(async (tx: any) => {
                await mutate(tx);
                throw retryFailure;
              });
            } catch (error) {
              if (error !== retryFailure) throw error;
            }
          }
          await db
            .update(schema.documents)
            .set({ ownerEmail: VIEWER })
            .where(eq(schema.documents.id, id));
          if (replayKind === "rollback recovery") throw retryFailure;
          return result;
        });
      try {
        const replayed = await runWithRequestContext(
          { userEmail: EDITOR },
          () =>
            updateDocumentAction.run(args, {
              caller: "frontend",
              actionName: "update-document",
              userEmail: EDITOR,
            }),
        );
        expect(replayed).toMatchObject({
          preservationRequired: true,
          checkpointId: (preserved as { checkpointId: string }).checkpointId,
          document: { content: "Original", accessRole: "editor" },
        });
        const { queryAuditEvents } = await import("@agent-native/core/audit");
        const events = await queryAuditEvents(
          { userEmail: VIEWER },
          { action: "update-document", targetType: "document", targetId: id },
        );
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          ownerEmail: VIEWER,
          actorEmail: EDITOR,
          status: "success",
        });
        expect(race).toHaveBeenCalledOnce();
        expect(earlyLookup).toHaveBeenCalledTimes(
          replayKind === "locked receipt" ? 2 : 3,
        );
      } finally {
        race.mockRestore();
        earlyLookup.mockRestore();
      }
    },
  );

  it("keeps the saved snapshot when a move changes owner before the save locks the page", async () => {
    const id = await createDocument({ content: "Before" });
    const db = getDb();
    await db.insert(schema.documentShares).values({
      id: nextId("moving-snapshot-share"),
      resourceId: id,
      principalType: "user",
      principalId: EDITOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
    const transaction = db.transaction.bind(db);
    const race = vi
      .spyOn(db, "transaction")
      .mockImplementationOnce(async (...args: unknown[]) => {
        await db
          .update(schema.documents)
          .set({ ownerEmail: EDITOR })
          .where(eq(schema.documents.id, id));
        return transaction(...args);
      });
    try {
      await expect(
        runWithRequestContext({ userEmail: EDITOR }, () =>
          updateDocumentAction.run(
            {
              id,
              title: "Moved page",
              baseTitle: "Untitled",
              content: "After",
              baseRevision: documentRevisionToken(0, "Before"),
              authoredBaseRevision: documentRevisionToken(0, "Before"),
              authoredBaseContent: "Before",
              authoredCandidateContent: "After",
              editorSessionId: nextId("moving-snapshot-session"),
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("moving-snapshot-attempt"),
            },
            {
              caller: "frontend",
              actionName: "update-document",
              userEmail: EDITOR,
            },
          ),
        ),
      ).resolves.toMatchObject({ id, title: "Moved page", content: "After" });
      expect(await documentRow(id)).toMatchObject({
        ownerEmail: EDITOR,
        title: "Moved page",
        content: "After",
      });
      expect(race).toHaveBeenCalledOnce();
      const listVersions = (await import("./list-document-versions.js"))
        .default;
      const versions = await runWithRequestContext({ userEmail: EDITOR }, () =>
        listVersions.run({ documentId: id, includeContent: true, limit: 100 }),
      );
      expect(
        versions.versions.map((version: any) => version.content),
      ).toContain("After");
      const storedVersions = await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id));
      expect(
        storedVersions.every((version: any) => version.ownerEmail === EDITOR),
      ).toBe(true);
      const { queryAuditEvents } = await import("@agent-native/core/audit");
      const events = await queryAuditEvents(
        { userEmail: EDITOR },
        {
          action: "update-document",
          targetType: "document",
          targetId: id,
        },
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorEmail: EDITOR,
        ownerEmail: EDITOR,
        status: "success",
      });
    } finally {
      race.mockRestore();
    }
  });

  it.each(["viewer", "revoked", "deleted"] as const)(
    "rejects a save when a move leaves %s access before the row lock",
    async (accessAfterMove) => {
      const id = await createDocument({
        title: "Original title",
        content: "Original",
      });
      const db = getDb();
      await db.insert(schema.documentShares).values({
        id: nextId("prelock-share"),
        resourceId: id,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
      const transaction = db.transaction.bind(db);
      const race = vi
        .spyOn(db, "transaction")
        .mockImplementationOnce(async (...args: unknown[]) => {
          await db
            .delete(schema.documentShares)
            .where(eq(schema.documentShares.resourceId, id));
          if (accessAfterMove === "deleted") {
            await db
              .delete(schema.documents)
              .where(eq(schema.documents.id, id));
          } else {
            await db
              .update(schema.documents)
              .set({ ownerEmail: VIEWER })
              .where(eq(schema.documents.id, id));
            if (accessAfterMove === "viewer") {
              await db.insert(schema.documentShares).values({
                id: nextId("prelock-viewer-share"),
                resourceId: id,
                principalType: "user",
                principalId: EDITOR,
                role: "viewer",
                createdBy: VIEWER,
                createdAt: new Date().toISOString(),
              });
            }
          }
          return transaction(...args);
        });
      try {
        await expect(
          runWithRequestContext({ userEmail: EDITOR }, () =>
            updateDocumentAction.run(
              { id, title: "Must not apply", description: "Must not apply" },
              { caller: "frontend", userEmail: EDITOR },
            ),
          ),
        ).rejects.toMatchObject(
          accessAfterMove === "deleted"
            ? { errorCode: "DOCUMENT_NOT_FOUND", statusCode: 404 }
            : { statusCode: 403 },
        );
        if (accessAfterMove !== "deleted") {
          expect(await documentRow(id)).toMatchObject({
            ownerEmail: VIEWER,
            title: "Original title",
            content: "Original",
            description: "",
          });
        }
        expect(race).toHaveBeenCalledOnce();
      } finally {
        race.mockRestore();
      }
    },
  );

  it("normalizes a duplicate title heading in an authored browser save", async () => {
    const id = await createDocument({ title: "Page", content: "Body before" });
    const revision = documentRevisionToken(0, "Body before");
    const saved = await measuredSave(
      () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              content: "# Page\nBody after",
              baseRevision: revision,
              authoredBaseRevision: revision,
              authoredBaseContent: "Body before",
              authoredCandidateContent: "# Page\nBody after",
              editorSessionId: nextId("heading-session"),
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("heading-attempt"),
            },
            {
              caller: "frontend",
              userEmail: OWNER,
              actionName: "update-document",
            },
          ),
        ),
      { outcome: "written", stale_base: "false", history_effect: "transition" },
    );
    expect(saved.content).toBe("Body after");
    expect((await documentRow(id)).content).toBe("Body after");
  });

  it("uses the locked body revision for a verified authored merge with only baseUpdatedAt", async () => {
    const base = "First passage\nSecond passage";
    const id = await createDocument({ content: base });
    const before = await documentRow(id);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: documentRevisionToken(0, base),
          idempotencyKey: nextId("mcp-before-timestamp-save"),
          find: "First passage",
          replace: "Agent first",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const saved = await measuredSave(
      () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              content: "First passage\nBrowser second",
              baseUpdatedAt: before.updatedAt,
              authoredBaseRevision: documentRevisionToken(0, base),
              authoredBaseContent: base,
              authoredCandidateContent: "First passage\nBrowser second",
              editorSessionId: nextId("timestamp-session"),
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("timestamp-attempt"),
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        ),
      { outcome: "merged", stale_base: "true", history_effect: "transition" },
    );
    expect(saved).toMatchObject({
      content: "Agent first\nBrowser second",
      bodyIntentOutcome: { status: "applied" },
    });
    expect((await documentRow(id)).bodyRevision).toBe(2);
  });

  it("writes a stale browser save that already holds a peer tab's change", async () => {
    const base = "Seed one\nSeed two\nLine one";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    const browserSave = (session: string, content: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          {
            id,
            content,
            baseRevision: revision,
            authoredBaseRevision: revision,
            authoredBaseContent: base,
            authoredCandidateContent: content,
            editorSessionId: session,
            editorEditGeneration: 1,
            browserSaveAttemptId: nextId("stale-attempt"),
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
    await browserSave(
      nextId("peer-session"),
      "Seed one\nSeed two peer\nLine one",
    );
    const typing = "Seed one\nSeed two peer\nLine one\nLine two";
    const saved = await browserSave(nextId("typing-session"), typing);
    expect(saved).toMatchObject({
      content: typing,
      bodyIntentOutcome: { status: "applied" },
    });
    expect(await documentRow(id)).toMatchObject({
      content: typing,
      bodyRevision: 2,
    });
  });

  it("replays a preserved attempt without duplicating its History checkpoint", async () => {
    const base = "First passage\nSecond passage";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: revision,
          idempotencyKey: nextId("mcp-before-preservation"),
          find: "First passage",
          replace: "Agent first",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const candidate = "First passage\nInserted passage\nSecond passage";
    const attemptId = nextId("preserved-attempt");
    const args = {
      id,
      title: "Draft title",
      baseTitle: "Untitled",
      content: candidate,
      baseRevision: revision,
      authoredBaseRevision: revision,
      authoredBaseContent: base,
      authoredCandidateContent: candidate,
      editorSessionId: nextId("preserved-session"),
      editorEditGeneration: 1,
      browserSaveAttemptId: attemptId,
    };
    const invoke = (input: typeof args) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(input, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    const first = await measuredSave(() => invoke(args), {
      outcome: "preserved_to_history",
      history_effect: "preservation",
      reason_code: "structure",
    });
    const retry = await measuredSave(() => invoke(args), {
      outcome: "replayed",
      history_effect: "none",
    });
    expect(first).toMatchObject({
      preservationRequired: true,
      reason: "structure",
    });
    expect(retry).toMatchObject({
      preservationRequired: true,
      checkpointId: first.checkpointId,
    });
    const [preserved] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, first.checkpointId));
    expect(preserved).toMatchObject({
      title: "Draft title",
      content: candidate,
    });
    expect((await documentRow(id)).title).toBe("Untitled");
    const lookup = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentSaveAttemptAction.run({ id, browserSaveAttemptId: attemptId }),
    );
    expect(lookup).toMatchObject({
      found: true,
      preservationRequired: {
        checkpointId: first.checkpointId,
        reason: "structure",
      },
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id)),
    ).toHaveLength(3);
    expect(
      await getDb()
        .select()
        .from(schema.documentBrowserSaveAttempts)
        .where(eq(schema.documentBrowserSaveAttempts.documentId, id)),
    ).toHaveLength(1);
    await expect(
      invoke({ ...args, content: `${candidate}\nchanged` }),
    ).rejects.toMatchObject({ errorCode: "BROWSER_SAVE_ATTEMPT_REUSED" });
  });

  it("settles a represented browser generation after an independent MCP edit is merged", async () => {
    const base = "First passage\nSecond passage";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    const session = nextId("browser-session");
    const browserCandidate = "First passage\nBrowser second";
    await getDb()
      .insert(schema.documentPreviewDrafts)
      .values({
        id: nextId("draft"),
        ownerEmail: OWNER,
        orgId: "",
        documentId: id,
        title: "Untitled",
        content: browserCandidate,
        editorSessionId: session,
        editGeneration: 1,
      });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: revision,
          idempotencyKey: nextId("mcp-first"),
          find: "First passage",
          replace: "Agent first",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const saved = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: browserCandidate,
          baseRevision: revision,
          authoredBaseRevision: revision,
          authoredBaseContent: base,
          authoredCandidateContent: browserCandidate,
          editorSessionId: session,
          editorEditGeneration: 1,
          editorSnapshotTitle: "Untitled",
          editorSnapshotContent: browserCandidate,
          browserSaveAttemptId: nextId("browser-after-mcp"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(saved).toMatchObject({
      content: "Agent first\nBrowser second",
      bodyIntentOutcome: { status: "applied" },
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, id)),
    ).toHaveLength(0);
  });

  it("preserves an unlineaged peer observation without poisoning later authored merges", async () => {
    const base = "Original beta gamma";
    const local = "Alpha beta gamma";
    const observed = "Alpha beta peer gamma";
    const id = await createDocument({ content: base });
    const session = nextId("browser-session");
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: local,
          baseRevision: documentRevisionToken(0, base),
          authoredBaseRevision: documentRevisionToken(0, base),
          authoredBaseContent: base,
          authoredCandidateContent: local,
          editorSessionId: session,
          editorEditGeneration: 1,
          editorSnapshotTitle: "Untitled",
          editorSnapshotContent: local,
          browserSaveAttemptId: nextId("local-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(first.content).toBe(local);

    const observationAttemptId = nextId("observed-attempt");
    const intentsBefore = await getDb()
      .select()
      .from(schema.documentBodyIntents)
      .where(eq(schema.documentBodyIntents.documentId, id));
    const observationArgs = {
      id,
      content: observed,
      baseRevision: first.revision,
      editorSessionId: session,
      editorEditGeneration: 1,
      editorSnapshotTitle: "Untitled",
      editorSnapshotContent: observed,
      browserSaveAttemptId: observationAttemptId,
    };
    const replay = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(observationArgs, {
        caller: "frontend",
        userEmail: OWNER,
      }),
    );
    expect(replay).toMatchObject({
      preservationRequired: true,
      reason: "provenance",
      document: { content: local, bodyRevision: 1 },
    });
    const checkpointId = "checkpointId" in replay ? replay.checkpointId : "";
    expect(checkpointId).toBeTruthy();
    expect(await documentRow(id)).toMatchObject({
      content: local,
      bodyRevision: 1,
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentBodyIntents)
        .where(eq(schema.documentBodyIntents.documentId, id)),
    ).toEqual(intentsBefore);
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, checkpointId)),
    ).toMatchObject([{ content: observed }]);
    const receiptReplay = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        updateDocumentAction.run(observationArgs, {
          caller: "frontend",
          userEmail: OWNER,
        }),
    );
    expect(receiptReplay).toMatchObject({
      preservationRequired: true,
      reason: "provenance",
      checkpointId,
    });

    const peer = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: observed,
          baseRevision: first.revision,
          authoredBaseRevision: first.revision,
          authoredBaseContent: local,
          authoredCandidateContent: observed,
          editorSessionId: nextId("peer-session"),
          editorEditGeneration: 1,
          browserSaveAttemptId: nextId("peer-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(peer).toMatchObject({
      content: observed,
      bodyRevision: 2,
      bodyIntentOutcome: { status: "applied" },
    });
    const independent = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: "Alpha local beta gamma",
          baseRevision: first.revision,
          authoredBaseRevision: first.revision,
          authoredBaseContent: local,
          authoredCandidateContent: "Alpha local beta gamma",
          editorSessionId: nextId("independent-session"),
          editorEditGeneration: 1,
          browserSaveAttemptId: nextId("independent-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(independent).toMatchObject({
      content: "Alpha local beta peer gamma",
      bodyRevision: 3,
      bodyIntentOutcome: { status: "applied" },
    });
  });

  it("replays the exact receipt after its editor generation settles", async () => {
    const id = await createDocument({ content: "Before" });
    const baseRevision = documentRevisionToken(0, "Before");
    const args = {
      id,
      content: "After",
      baseRevision,
      authoredBaseRevision: baseRevision,
      authoredBaseContent: "Before",
      authoredCandidateContent: "After",
      editorSessionId: nextId("settled-replay-session"),
      editorEditGeneration: 1,
      editorSnapshotTitle: "Untitled",
      editorSnapshotContent: "After",
      browserSaveAttemptId: nextId("settled-replay-attempt"),
    };
    const save = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );

    const first = await save();
    const retry = await save();

    expect(first).toMatchObject({
      content: "After",
      browserSaveAttempt: { result: "applied" },
    });
    expect(retry).toMatchObject({
      content: "After",
      browserSaveAttempt: { result: "replayed" },
    });
    expect(await documentRow(id)).toMatchObject({
      content: "After",
      bodyRevision: 1,
    });
  });

  it("allows a frontend metadata save that echoes the unchanged body", async () => {
    const id = await createDocument({ title: "Before", content: "Body" });
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          title: "After",
          content: "Body",
          baseTitle: "Before",
          baseRevision: documentRevisionToken(0, "Body"),
          browserSaveAttemptId: nextId("metadata-attempt"),
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(result).toMatchObject({
      title: "After",
      content: "Body",
      bodyRevision: 0,
      browserSaveAttempt: { result: "applied" },
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentBodyIntents)
        .where(eq(schema.documentBodyIntents.documentId, id)),
    ).toHaveLength(0);
  });

  it("converges overlapping browser sessions regardless of save delivery order", async () => {
    const base = "Base passage\nUnrelated passage";
    const revision = documentRevisionToken(0, base);
    const results: string[] = [];
    for (const order of [
      ["a", "z"],
      ["z", "a"],
    ] as const) {
      const id = await createDocument({ content: base });
      for (const session of order) {
        const candidate = `${session} passage\nUnrelated passage`;
        await runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              content: candidate,
              baseRevision: revision,
              authoredBaseRevision: revision,
              authoredBaseContent: base,
              authoredCandidateContent: candidate,
              editorSessionId: session,
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("overlap-attempt"),
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        );
      }
      results.push((await documentRow(id)).content);
      const history = await getDb()
        .select({ content: schema.documentVersions.content })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id));
      expect(
        history.map((version: { content: string }) => version.content),
      ).toContain("a passage\nUnrelated passage");
    }
    expect(results).toEqual([
      "z passage\nUnrelated passage",
      "z passage\nUnrelated passage",
    ]);
  });

  it("accepts an editor generation resent from a rebased base as the same delivery", async () => {
    for (const rebasedFirst of [false, true]) {
      const base = "First passage\nSecond passage";
      const id = await createDocument({ content: base });
      const baseRevision = documentRevisionToken(0, base);
      const editorSessionId = nextId("rebased-session");
      const save = (args: {
        content: string;
        baseRevision: string;
        authoredBaseContent: string;
        editorEditGeneration: number;
      }) =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              ...args,
              authoredBaseRevision: args.baseRevision,
              authoredCandidateContent: args.content,
              editorSessionId,
              browserSaveAttemptId: nextId("rebased-attempt"),
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        );
      const first = "First passage edited\nSecond passage";
      await save({
        content: first,
        baseRevision,
        authoredBaseContent: base,
        editorEditGeneration: 1,
      });
      const afterFirst = await documentRow(id);
      const second = "First passage edited\nSecond passage edited";
      // A hidden tab's keepalive copy or the page's draft journal sends
      // generation 2 from the base recorded before generation 1 landed...
      const sendOriginal = () =>
        save({
          content: second,
          baseRevision,
          authoredBaseContent: base,
          editorEditGeneration: 2,
        });
      // ...and the editor's own flush sends it rebased onto generation 1.
      // Either delivery can arrive first.
      const sendRebased = () =>
        save({
          content: second,
          baseRevision: documentRevisionToken(
            afterFirst.bodyRevision,
            afterFirst.content,
          ),
          authoredBaseContent: afterFirst.content,
          editorEditGeneration: 2,
        });
      const earlier = await (rebasedFirst ? sendRebased() : sendOriginal());
      const later = await (rebasedFirst ? sendOriginal() : sendRebased());

      expect(earlier.bodyIntentOutcome).toEqual({ status: "applied" });
      expect(later.bodyIntentOutcome).toEqual(earlier.bodyIntentOutcome);
      expect((await documentRow(id)).content).toBe(second);
      expect(
        await getDb()
          .select()
          .from(schema.documentBodyIntents)
          .where(eq(schema.documentBodyIntents.documentId, id)),
      ).toHaveLength(2);
    }
  });

  it("replays a displaced editor generation through a new transport attempt", async () => {
    const base = "Shared passage\nOther passage";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: revision,
          idempotencyKey: nextId("agent-overlap"),
          find: "Shared passage",
          replace: "Agent passage",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const candidate = "Browser passage\nOther passage";
    const identity = {
      id,
      content: candidate,
      baseRevision: revision,
      authoredBaseRevision: revision,
      authoredBaseContent: base,
      authoredCandidateContent: candidate,
      editorSessionId: nextId("displaced-session"),
      editorEditGeneration: 1,
    };
    const save = (attemptId: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          { ...identity, browserSaveAttemptId: attemptId },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
    const first = await measuredSave(() => save(nextId("first-attempt")), {
      outcome: "merged_with_displaced_text",
      history_effect: "preservation",
    });
    const retry = await measuredSave(() => save(nextId("retry-attempt")), {
      outcome: "replayed",
      history_effect: "none",
    });
    expect(first.bodyIntentOutcome).toMatchObject({
      status: "displaced-preserved",
    });
    expect(retry.bodyIntentOutcome).toEqual(first.bodyIntentOutcome);
    expect((await documentRow(id)).content).toBe(
      "Agent passage\nOther passage",
    );
    expect(
      await getDb()
        .select()
        .from(schema.documentBodyIntents)
        .where(eq(schema.documentBodyIntents.documentId, id)),
    ).toHaveLength(2);
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id)),
    ).toHaveLength(3);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          {
            ...identity,
            content: "Different browser passage\nOther passage",
            authoredCandidateContent:
              "Different browser passage\nOther passage",
            browserSaveAttemptId: nextId("reused-generation"),
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "EDITOR_BODY_INTENT_REUSED" });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          {
            ...identity,
            title: "Different title",
            baseTitle: "Untitled",
            browserSaveAttemptId: nextId("reused-generation-title"),
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "EDITOR_BODY_INTENT_REUSED" });
  });

  it("replays an applied editor generation after a later independent edit", async () => {
    const base = "Browser base\nAgent base";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    const session = nextId("applied-session");
    const args = {
      id,
      content: "Browser changed\nAgent base",
      baseRevision: revision,
      authoredBaseRevision: revision,
      authoredBaseContent: base,
      authoredCandidateContent: "Browser changed\nAgent base",
      editorSessionId: session,
      editorEditGeneration: 1,
    };
    const save = (browserSaveAttemptId: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          { ...args, browserSaveAttemptId },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
    await save(nextId("first-applied"));
    const afterBrowser = await documentRow(id);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: documentRevisionToken(
            afterBrowser.bodyRevision,
            afterBrowser.content,
          ),
          idempotencyKey: nextId("later-agent"),
          find: "Agent base",
          replace: "Agent changed",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const retry = await save(nextId("retry-applied"));
    expect(retry.bodyIntentOutcome).toEqual({ status: "applied" });
    expect((await documentRow(id)).content).toBe(
      "Browser changed\nAgent changed",
    );
    expect(
      await getDb()
        .select()
        .from(schema.documentBodyIntents)
        .where(eq(schema.documentBodyIntents.documentId, id)),
    ).toHaveLength(2);
  });

  it("converges browser and MCP overlaps in either commit order while keeping independent edits", async () => {
    const base = "Base passage\nOther passage\nThird passage";
    const browserCandidate = "Browser passage\nOther passage\nBrowser third";
    const expected = "Agent passage\nOther passage\nBrowser third";
    for (const first of ["browser", "mcp"] as const) {
      const id = await createDocument({ content: base });
      const revision = documentRevisionToken(0, base);
      const browser = () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              content: browserCandidate,
              baseRevision: revision,
              authoredBaseRevision: revision,
              authoredBaseContent: base,
              authoredCandidateContent: browserCandidate,
              editorSessionId: `browser-${first}`,
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("browser-attempt"),
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        );
      const mcp = () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          editDocumentAction.run(
            {
              id,
              baseRevision: revision,
              idempotencyKey: nextId("mcp-edit"),
              find: "Base passage",
              replace: "Agent passage",
            },
            { caller: "mcp", userEmail: OWNER },
          ),
        );
      if (first === "browser") {
        await browser();
        await mcp();
      } else {
        await mcp();
        await browser();
      }
      expect((await documentRow(id)).content).toBe(expected);
      const history = await getDb()
        .select({ content: schema.documentVersions.content })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id));
      expect(
        history.map((version: { content: string }) => version.content),
      ).toContain(browserCandidate);
    }
  });

  it("keeps an acknowledged edit when an interleaved stale editor snapshot drops it", async () => {
    const base =
      "Alpha paragraph\nBravo paragraph\nCharlie paragraph\nDelta paragraph";
    const id = await createDocument({ content: base });
    const baseRevision = documentRevisionToken(0, base);
    const editorSessionId = nextId("browser-a");
    const otherSessionId = nextId("browser-b");
    const authoredBase = { content: base, revision: baseRevision };
    const editorBase = createAuthoredContentBase();

    const save = (args: {
      candidate: string;
      authoredBase: { content: string; revision: string };
      sessionId: string;
      generation: number;
    }) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          {
            id,
            content: args.candidate,
            baseRevision: args.authoredBase.revision,
            authoredBaseRevision: args.authoredBase.revision,
            authoredBaseContent: args.authoredBase.content,
            authoredCandidateContent: args.candidate,
            editorSessionId: args.sessionId,
            editorEditGeneration: args.generation,
            browserSaveAttemptId: nextId("interleaved-attempt"),
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
    const append = (content: string, paragraph: number, marker: string) => {
      const lines = content.split("\n");
      lines[paragraph] = `${lines[paragraph]} ${marker}`;
      return lines.join("\n");
    };
    const markerA1 = "A-first";
    const markerB1 = "B-first";
    const markerA2 = "A-second";
    const markerB2 = "B-second";
    const markerA3 = "A-third";

    const a1 = append(base, 0, markerA1);
    editorBase.edited(a1);
    const savedA1 = await save({
      candidate: a1,
      authoredBase,
      sessionId: editorSessionId,
      generation: 10,
    });
    const a1Base = { content: savedA1.content, revision: savedA1.revision };
    editorBase.saved({
      saved: a1Base,
      sentContent: a1,
      authoredOn: authoredBase,
    });

    const b1 = append(append(base, 0, markerA1), 2, markerB1);
    const savedB1 = await save({
      candidate: b1,
      authoredBase,
      sessionId: otherSessionId,
      generation: 10,
    });
    const b1Base = { content: savedB1.content, revision: savedB1.revision };

    const a2 = append(b1, 0, markerA2);
    editorBase.edited(a2);
    const savedA2 = await save({
      candidate: a2,
      authoredBase: a1Base,
      sessionId: editorSessionId,
      generation: 20,
    });
    const a2Base = { content: savedA2.content, revision: savedA2.revision };
    editorBase.saved({
      saved: a2Base,
      sentContent: a2,
      authoredOn: a1Base,
    });

    const b2 = append(b1, 2, markerB2);
    const savedB2 = await save({
      candidate: b2,
      authoredBase: b1Base,
      sessionId: otherSessionId,
      generation: 20,
    });

    // A stale collaboration snapshot keeps B's latest paragraph but drops
    // text that A's earlier save was already acknowledged with.
    const staleSnapshot = append(
      append(append(base, 0, markerA1), 2, markerB1),
      2,
      markerB2,
    );
    editorBase.observed(staleSnapshot, a2Base);
    const staleEditorBase = editorBase.base(a2Base);
    expect(staleEditorBase).toEqual(a1Base);
    const a3 = append(staleSnapshot, 0, markerA3);
    editorBase.edited(a3);

    const savedA3 = await save({
      candidate: a3,
      authoredBase: staleEditorBase,
      sessionId: editorSessionId,
      generation: 30,
    });
    expect(savedA3.bodyIntentOutcome).toEqual({ status: "applied" });
    for (const marker of [markerA1, markerB1, markerA2, markerB2]) {
      expect(savedB2.content).toContain(marker);
    }
    for (const marker of [markerA1, markerB1, markerA2, markerB2, markerA3]) {
      expect(savedA3.content.split(marker)).toHaveLength(2);
    }
  });

  it("records a browser save with its canonical write and replays only the same payload", async () => {
    const id = await createDocument({ content: "Before" });
    const before = await documentRow(id);
    const args = {
      id,
      content: "After",
      baseRevision: documentRevisionToken(before.bodyRevision, before.content),
      authoredBaseRevision: documentRevisionToken(
        before.bodyRevision,
        before.content,
      ),
      authoredBaseContent: before.content,
      authoredCandidateContent: "After",
      editorSessionId: nextId("receipt-session"),
      editorEditGeneration: 1,
      browserSaveAttemptId: nextId("save"),
    };
    const invoke = (input: typeof args) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(input, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    const first = await invoke(args);
    expect(first).toMatchObject({
      content: "After",
      browserSaveAttempt: {
        attemptId: args.browserSaveAttemptId,
        result: "applied",
      },
    });
    const after = await documentRow(id);
    const retry = await invoke(args);
    expect(retry).toMatchObject({
      content: "After",
      browserSaveAttempt: {
        attemptId: args.browserSaveAttemptId,
        result: "replayed",
        revision: documentRevisionToken(after.bodyRevision, after.content),
      },
    });
    expect(await documentRow(id)).toMatchObject({
      content: "After",
      bodyRevision: after.bodyRevision,
      updatedAt: after.updatedAt,
    });
    await expect(
      invoke({ ...args, content: "Different" }),
    ).rejects.toMatchObject({
      errorCode: "BROWSER_SAVE_ATTEMPT_REUSED",
    });
    expect((await documentRow(id)).content).toBe("After");
    const lookup = await runWithRequestContext({ userEmail: OWNER }, () =>
      getDocumentSaveAttemptAction.run({
        id,
        browserSaveAttemptId: args.browserSaveAttemptId,
      }),
    );
    expect(lookup).toMatchObject({
      found: true,
      browserSaveAttempt: {
        attemptId: args.browserSaveAttemptId,
        revision: documentRevisionToken(after.bodyRevision, after.content),
      },
    });
  });

  it("accepts idempotent browser saves only from the scoped document widget", async () => {
    const id = await createDocument({ content: "Before" });
    const before = await documentRow(id);
    const args = {
      id,
      content: "After",
      baseRevision: documentRevisionToken(before.bodyRevision, before.content),
      authoredBaseRevision: documentRevisionToken(
        before.bodyRevision,
        before.content,
      ),
      authoredBaseContent: before.content,
      authoredCandidateContent: "After",
      editorSessionId: nextId("widget-save-session"),
      editorEditGeneration: 1,
      browserSaveAttemptId: nextId("widget-save"),
    };
    const widgetContext = {
      caller: "mcp-widget-write" as const,
      userEmail: OWNER,
      mcpDirectoryWidgetWrite: {
        appId: "content",
        resourceIds: { documentId: id },
        actionNames: ["update-document"],
      },
    };
    const deliver = (
      context: typeof widgetContext,
      input: typeof args = args,
    ) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(input, context),
      );

    const first = await deliver(widgetContext);
    expect(first).toMatchObject({
      content: "After",
      browserSaveAttempt: {
        attemptId: args.browserSaveAttemptId,
        result: "applied",
      },
    });
    const saved = await documentRow(id);
    const replay = await deliver(widgetContext);
    expect(replay).toMatchObject({
      content: "After",
      browserSaveAttempt: {
        attemptId: args.browserSaveAttemptId,
        result: "replayed",
        revision: documentRevisionToken(saved.bodyRevision, saved.content),
      },
    });
    await expect(
      deliver(widgetContext, {
        ...args,
        content: "Different",
        authoredCandidateContent: "Different",
      }),
    ).rejects.toMatchObject({ errorCode: "BROWSER_SAVE_ATTEMPT_REUSED" });

    const wrongDocument = {
      ...widgetContext,
      mcpDirectoryWidgetWrite: {
        ...widgetContext.mcpDirectoryWidgetWrite,
        resourceIds: { documentId: "another-document" },
      },
    };
    await expect(deliver(wrongDocument)).rejects.toMatchObject({
      errorCode: "mcp_widget_write_scope_mismatch",
    });
    await expect(
      deliver({
        ...widgetContext,
        mcpDirectoryWidgetWrite: {
          ...widgetContext.mcpDirectoryWidgetWrite,
          actionNames: [],
        },
      }),
    ).rejects.toMatchObject({
      errorCode: "mcp_widget_write_scope_mismatch",
    });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, {
          caller: "mcp",
          userEmail: OWNER,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "INVALID_BROWSER_SAVE_ATTEMPT" });
  });

  it("renames a document through a title-only widget write", async () => {
    const id = await createDocument({ title: "Before", content: "Body" });
    const grant = {
      appId: "content",
      resourceIds: { documentId: id },
      actionNames: ["update-document"],
    };
    const rename = (
      args: Record<string, unknown>,
      mcpDirectoryWidgetWrite = grant,
    ) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          { id, ...args },
          {
            caller: "mcp-widget-write" as const,
            userEmail: OWNER,
            mcpDirectoryWidgetWrite,
          },
        ),
      );

    const attemptId = nextId("widget-title-save");
    await expect(
      rename({
        title: "After",
        baseTitle: "Before",
        historySessionId: nextId("widget-title-session"),
        browserSaveAttemptId: attemptId,
      }),
    ).resolves.toMatchObject({
      browserSaveAttempt: { attemptId, result: "applied" },
    });
    expect(await documentRow(id)).toMatchObject({
      title: "After",
      content: "Body",
    });

    await rename({ title: "Final" });
    expect(await documentRow(id)).toMatchObject({
      title: "Final",
      content: "Body",
    });

    await expect(
      rename(
        { title: "Elsewhere" },
        { ...grant, resourceIds: { documentId: "another-document" } },
      ),
    ).rejects.toMatchObject({ errorCode: "mcp_widget_write_scope_mismatch" });
    expect(await documentRow(id)).toMatchObject({ title: "Final" });
  });

  it.each([
    "missing grant",
    "wrong document",
    "wrong app",
    "wrong action",
  ] as const)(
    "rejects favorite-only widget writes with %s before provisioning",
    async (reason) => {
      const id = await createDocument({
        title: "Widget favorite scope",
        content: "Favorite writes need a document grant.",
      });
      const grantContext = {
        caller: "mcp-widget-write" as const,
        mcpDirectoryWidgetWrite: {
          appId: "content",
          resourceIds: { documentId: id },
          actionNames: ["update-document"],
        },
      };
      const context =
        reason === "missing grant"
          ? { caller: "mcp-widget-write" as const }
          : reason === "wrong document"
            ? {
                ...grantContext,
                mcpDirectoryWidgetWrite: {
                  ...grantContext.mcpDirectoryWidgetWrite,
                  resourceIds: { documentId: "another-document" },
                },
              }
            : reason === "wrong app"
              ? {
                  ...grantContext,
                  mcpDirectoryWidgetWrite: {
                    ...grantContext.mcpDirectoryWidgetWrite,
                    appId: "design",
                  },
                }
              : {
                  ...grantContext,
                  mcpDirectoryWidgetWrite: {
                    ...grantContext.mcpDirectoryWidgetWrite,
                    actionNames: ["add-database-item"],
                  },
                };

      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run({ id, isFavorite: true }, context),
        ),
      ).rejects.toMatchObject({
        errorCode: "mcp_widget_write_scope_mismatch",
        statusCode: 403,
      });
      expect(await documentRow(id)).toMatchObject({
        title: "Widget favorite scope",
      });
    },
  );

  it("preserves newer body content when a widget save omits its base", async () => {
    const id = await createDocument({ content: "Before" });
    const initial = await documentRow(id);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: documentRevisionToken(
            initial.bodyRevision,
            initial.content,
          ),
          idempotencyKey: nextId("widget-stale-agent-edit"),
          find: "Before",
          replace: "Agent current",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );

    const browserSaveAttemptId = nextId("widget-stale-save");
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        { id, content: "Stale browser body", browserSaveAttemptId },
        {
          caller: "mcp-widget-write",
          userEmail: OWNER,
          mcpDirectoryWidgetWrite: {
            appId: "content",
            resourceIds: { documentId: id },
            actionNames: ["update-document"],
          },
        },
      ),
    );

    expect(result).toMatchObject({
      conflict: true,
      document: { content: "Agent current" },
    });
    expect(await documentRow(id)).toMatchObject({
      content: "Agent current",
      bodyRevision: initial.bodyRevision + 1,
    });
    expect(
      await runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentSaveAttemptAction.run({ id, browserSaveAttemptId }),
      ),
    ).toEqual({ found: false });
  });

  it("replays a lost title-only browser response without reverting a later rename", async () => {
    const id = await createDocument({ title: "Before", content: "Body" });
    const args = {
      id,
      title: "Browser title",
      browserSaveAttemptId: nextId("title-save"),
    };
    const deliver = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    const first = await deliver();
    expect(first.browserSaveAttempt).toMatchObject({
      attemptId: args.browserSaveAttemptId,
      result: "applied",
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id, title: "Newer title" }),
    );
    const replay = await deliver();
    expect(replay.browserSaveAttempt).toMatchObject({
      attemptId: args.browserSaveAttemptId,
      result: "replayed",
    });
    expect(await documentRow(id)).toMatchObject({
      title: "Newer title",
      content: "Body",
      bodyRevision: 0,
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentBrowserSaveAttempts)
        .where(eq(schema.documentBrowserSaveAttempts.documentId, id)),
    ).toHaveLength(1);
  });

  it("deduplicates concurrent browser deliveries of one lifecycle attempt", async () => {
    const id = await createDocument({ content: "Before" });
    const args = {
      id,
      content: "After",
      baseRevision: documentRevisionToken(0, "Before"),
      authoredBaseRevision: documentRevisionToken(0, "Before"),
      authoredBaseContent: "Before",
      authoredCandidateContent: "After",
      editorSessionId: nextId("lifecycle-session"),
      editorEditGeneration: 1,
      browserSaveAttemptId: nextId("lifecycle-attempt"),
    };
    const deliver = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    const [visibility, pagehide] = await Promise.all([deliver(), deliver()]);
    expect(
      new Set([
        visibility.browserSaveAttempt?.result,
        pagehide.browserSaveAttempt?.result,
      ]),
    ).toEqual(new Set(["applied", "replayed"]));
    expect(await documentRow(id)).toMatchObject({
      content: "After",
      bodyRevision: 1,
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentBrowserSaveAttempts)
        .where(eq(schema.documentBrowserSaveAttempts.documentId, id)),
    ).toHaveLength(1);
    const history = await getDb()
      .select({ content: schema.documentVersions.content })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, id));
    expect(
      history.map((version: { content: string }) => version.content),
    ).toEqual(expect.arrayContaining(["Before", "After"]));
    expect(history).toHaveLength(2);
  });

  it("replays a lost committed response after a later canonical edit", async () => {
    const id = await createDocument({
      content: "First passage\nSecond passage",
    });
    const args = {
      id,
      content: "First passage\nBrowser second",
      baseRevision: documentRevisionToken(0, "First passage\nSecond passage"),
      authoredBaseRevision: documentRevisionToken(
        0,
        "First passage\nSecond passage",
      ),
      authoredBaseContent: "First passage\nSecond passage",
      authoredCandidateContent: "First passage\nBrowser second",
      editorSessionId: nextId("lost-response-session"),
      editorEditGeneration: 1,
      browserSaveAttemptId: nextId("lost-response"),
    };
    const deliver = (input: typeof args) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(input, {
          caller: "frontend",
          userEmail: OWNER,
        }),
      );
    await deliver(args);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: documentRevisionToken(
            1,
            "First passage\nBrowser second",
          ),
          idempotencyKey: nextId("after-lost-response"),
          find: "First passage",
          replace: "Agent first",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const replay = await deliver(args);
    expect(replay.browserSaveAttempt).toMatchObject({
      attemptId: args.browserSaveAttemptId,
      result: "replayed",
      revision: documentRevisionToken(1, args.content),
    });
    expect(await documentRow(id)).toMatchObject({
      content: "Agent first\nBrowser second",
      bodyRevision: 2,
    });
    await expect(
      deliver({
        ...args,
        baseRevision: documentRevisionToken(1, args.content),
      }),
    ).rejects.toMatchObject({ errorCode: "BROWSER_SAVE_ATTEMPT_REUSED" });
  });

  it("does not confirm a conflicted browser save and keeps lookup actor scoped", async () => {
    const id = await createDocument({ content: "Before" });
    const attemptId = nextId("save");
    const conflict = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          title: "Rejected title",
          baseTitle: "Stale title",
          content: "Rejected",
          baseRevision: documentRevisionToken(0, "stale"),
          authoredBaseRevision: documentRevisionToken(0, "Before"),
          authoredBaseContent: "Before",
          authoredCandidateContent: "Rejected",
          editorSessionId: nextId("conflict-session"),
          editorEditGeneration: 1,
          browserSaveAttemptId: attemptId,
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(conflict).toMatchObject({ conflict: true });
    expect(
      await runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentSaveAttemptAction.run({
          id,
          browserSaveAttemptId: attemptId,
        }),
      ),
    ).toEqual({ found: false });
    expect((await documentRow(id)).content).toBe("Before");
  });

  it("does not expose an owner's save receipt to a shared editor", async () => {
    const id = await createDocument({ content: "Before" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: id,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
    const browserSaveAttemptId = nextId("save");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        { id, content: "After", browserSaveAttemptId },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(
      await runWithRequestContext({ userEmail: EDITOR }, () =>
        getDocumentSaveAttemptAction.run({ id, browserSaveAttemptId }),
      ),
    ).toEqual({ found: false });
  });

  it("does not confirm a browser payload suppressed by stale empty-body protection", async () => {
    const id = await createDocument({ content: "Hydrated body" });
    const attemptId = nextId("save");
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run(
        {
          id,
          content: "<empty-block/>",
          loadedUpdatedAt: "2026-01-01T00:00:00.000Z",
          loadedContentWasEmpty: true,
          browserSaveAttemptId: attemptId,
        },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    expect(result).toMatchObject({
      conflict: true,
      document: { content: "Hydrated body" },
    });
    expect(
      await runWithRequestContext({ userEmail: OWNER }, () =>
        getDocumentSaveAttemptAction.run({
          id,
          browserSaveAttemptId: attemptId,
        }),
      ),
    ).toEqual({ found: false });
  });
  it("prepends only a newly created favorite membership and removes its order reference on unpin", async () => {
    const { getUserSetting } = await import("@agent-native/core/settings");
    const { favoritesSystemIds } = await import("./_content-favorites.js");
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const first = await createDocument({ title: "First" });
    const second = await createDocument({ title: "Second" });
    for (const id of [first, second]) {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id, isFavorite: true }),
      );
    }
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: second, isFavorite: true }),
    );
    const databaseId = favoritesSystemIds(OWNER).databaseId;
    const memberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const secondMembership = memberships.find(
      (item: any) => item.documentId === second,
    )!.id;
    const firstMembership = memberships.find(
      (item: any) => item.documentId === first,
    )!.id;
    const settingKey = personalDatabaseViewSettingKey(databaseId);
    expect(await getUserSetting(OWNER, settingKey)).toMatchObject({
      views: [
        {
          sidebarOrder: {
            mode: "custom",
            itemIds: [secondMembership, firstMembership],
          },
        },
      ],
    });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: second, isFavorite: false }),
    );
    expect(await getUserSetting(OWNER, settingKey)).toMatchObject({
      views: [{ sidebarOrder: { itemIds: [firstMembership] } }],
    });
  });

  it("keeps favorite membership and order consistent under concurrent pin and unpin", async () => {
    const { getUserSetting } = await import("@agent-native/core/settings");
    const { favoritesSystemIds } = await import("./_content-favorites.js");
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const documentId = await createDocument({ title: "Concurrent favorite" });
    const invoke = (isFavorite: boolean) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id: documentId, isFavorite }),
      );

    await Promise.all([invoke(true), invoke(true)]);
    const databaseId = favoritesSystemIds(OWNER).databaseId;
    let memberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    expect(
      memberships.filter((row: any) => row.documentId === documentId),
    ).toHaveLength(1);

    await Promise.all([invoke(true), invoke(false)]);
    memberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const membershipIds = new Set(memberships.map((row: any) => row.id));
    const setting = await getUserSetting(
      OWNER,
      personalDatabaseViewSettingKey(databaseId),
    );
    const references = ((setting?.views as any[]) ?? []).flatMap(
      (view) => view.sidebarOrder?.itemIds ?? [],
    );
    expect(references.every((id: string) => membershipIds.has(id))).toBe(true);
  });

  it("preserves a concurrent pin while an ordinary personal reorder commits", async () => {
    const { getUserSetting } = await import("@agent-native/core/settings");
    const { favoritesSystemIds } = await import("./_content-favorites.js");
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const first = await createDocument({ title: "Reorder first" });
    const second = await createDocument({ title: "Reorder second" });
    const concurrent = await createDocument({ title: "Concurrent pin" });
    for (const id of [first, second]) {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id, isFavorite: true }),
      );
    }
    const databaseId = favoritesSystemIds(OWNER).databaseId;
    const memberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const membershipByDocument = new Map(
      memberships.map((item: any) => [item.documentId, item.id]),
    );
    const requestedOrder = [
      membershipByDocument.get(first)!,
      membershipByDocument.get(second)!,
    ];

    await Promise.all([
      runWithRequestContext({ userEmail: OWNER }, () =>
        updatePersonalViewAction.run(
          {
            databaseId,
            navigation: {
              sidebarOrder: {
                viewId: "default",
                mode: "custom",
                itemIds: requestedOrder,
              },
            },
          },
          { userEmail: OWNER },
        ),
      ),
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({ id: concurrent, isFavorite: true }),
      ),
    ]);

    const finalMemberships = await getDb()
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const concurrentMembership = finalMemberships.find(
      (item: any) => item.documentId === concurrent,
    )!.id;
    const setting = await getUserSetting(
      OWNER,
      personalDatabaseViewSettingKey(databaseId),
    );
    const order = (setting?.views as any[])[0].sidebarOrder.itemIds as string[];
    expect(order).toEqual(
      expect.arrayContaining([...requestedOrder, concurrentMembership]),
    );
    const finalMembershipIds = new Set(
      finalMemberships.map((item: any) => item.id),
    );
    expect(order.every((id) => finalMembershipIds.has(id))).toBe(true);
    expect(order.indexOf(requestedOrder[0])).toBeLessThan(
      order.indexOf(requestedOrder[1]),
    );
  });

  it("rolls back a failed favorite setting write without damaging a competing success", async () => {
    const { getUserSetting } = await import("@agent-native/core/settings");
    const { favoritesSystemIds } = await import("./_content-favorites.js");
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const failedCandidate = await createDocument({ title: "Failed candidate" });
    const successfulCandidate = await createDocument({
      title: "Successful candidate",
    });
    const db = getDb();
    const originalTransaction = db.transaction.bind(db);
    let failOneSettingWrite = true;
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementation(async (callback: any, config?: any) =>
        originalTransaction(async (tx: any) => {
          let executeCount = 0;
          const wrapped = Object.create(tx);
          wrapped.execute = async (...executeArgs: any[]) => {
            executeCount += 1;
            if (failOneSettingWrite && executeCount === 3) {
              failOneSettingWrite = false;
              throw new Error("simulated setting write failure");
            }
            return tx.execute(...executeArgs);
          };
          return callback(wrapped);
        }, config),
      );
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled(
        [failedCandidate, successfulCandidate].map((id) =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run({ id, isFavorite: true }),
          ),
        ),
      );
    } finally {
      transaction.mockRestore();
    }
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const databaseId = favoritesSystemIds(OWNER).databaseId;
    const memberships = await db
      .select({
        id: schema.contentDatabaseItems.id,
        documentId: schema.contentDatabaseItems.documentId,
      })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, databaseId));
    const membershipIds = new Set(memberships.map((row: any) => row.id));
    const setting = await getUserSetting(
      OWNER,
      personalDatabaseViewSettingKey(databaseId),
    );
    const references = ((setting?.views as any[]) ?? []).flatMap(
      (view) => view.sidebarOrder?.itemIds ?? [],
    );
    expect(references.every((id: string) => membershipIds.has(id))).toBe(true);
    expect(
      memberships.filter((row: any) =>
        [failedCandidate, successfulCandidate].includes(row.documentId),
      ),
    ).toHaveLength(1);
  });
  it("initializes an empty body through the externally callable edit action", async () => {
    const documentId = await createDocument({
      title: "Keep this title",
      content: "",
    });
    const before = await documentRow(documentId);
    const content = "# Keep this title\n\nExact body 🌿\n";

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id: documentId,
          baseRevision: documentRevisionToken(0, ""),
          idempotencyKey: "external-empty-initialization",
          initializeContent: content,
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const after = await documentRow(documentId);

    expect(result.receipt).toMatchObject({
      outcome: "applied",
      readback: { verified: true },
    });
    expect(after).toMatchObject({
      id: before.id,
      title: before.title,
      description: before.description,
      parentId: before.parentId,
      visibility: before.visibility,
      content,
      bodyRevision: 1,
    });
  });

  it("rejects conflicting initialization modes before writing", async () => {
    const documentId = await createDocument({ content: "" });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        editDocumentAction.run(
          {
            id: documentId,
            baseRevision: documentRevisionToken(0, ""),
            idempotencyKey: "conflicting-initialization",
            initializeContent: "body",
            find: "something",
            replace: "else",
          },
          { caller: "mcp", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_EDIT_MODE_CONFLICT" });
    expect((await documentRow(documentId)).content).toBe("");
  });

  it.each([
    {
      protocol: "base revision only",
      fields: { baseRevision: "body:0:sha256:invalid" },
    },
    {
      protocol: "idempotency key only",
      fields: { idempotencyKey: "partial-edit-protocol" },
    },
  ])("rejects a partial revision protocol: $protocol", async ({ fields }) => {
    const documentId = await createDocument({ content: "original" });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        editDocumentAction.run(
          {
            id: documentId,
            find: "original",
            replace: "changed",
            ...fields,
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_EDIT_PROTOCOL_REQUIRED",
    });
    expect((await documentRow(documentId)).content).toBe("original");
  });

  it("rejects external full-body writes outside the revisioned edit protocol", async () => {
    const documentId = await createDocument({ content: "original" });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(
          { id: documentId, content: "blind external rewrite" },
          { caller: "mcp", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_EDIT_PROTOCOL_REQUIRED",
    });
    expect((await documentRow(documentId)).content).toBe("original");
  });

  it("uses a canonical Files database rename as the workspace name", async () => {
    const { provisionContentSpaces, systemIdsForContentSpace } =
      await import("./_content-spaces.js");
    const provisioned = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    const filesDocumentId = systemIdsForContentSpace(
      provisioned.personalSpaceId,
      "files",
    ).documentId;

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: filesDocumentId, title: "Research" }),
    );

    const [space] = await getDb()
      .select()
      .from(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, provisioned.personalSpaceId));
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.documentId, filesDocumentId));
    const [catalogReference] = await getDb()
      .select({ document: schema.documents })
      .from(schema.contentSpaceCatalogItems)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentSpaceCatalogItems.documentId),
      )
      .where(
        eq(
          schema.contentSpaceCatalogItems.spaceId,
          provisioned.personalSpaceId,
        ),
      );

    expect(space.name).toBe("Research");
    expect(database.title).toBe("Research");
    expect((await documentRow(filesDocumentId)).title).toBe("Research");
    expect(catalogReference.document.title).toBe("Research");
  });

  it("applies a content save with no baseUpdatedAt exactly like today (no CAS)", async () => {
    const documentId = await createDocument({ content: "original" });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, content: "rewritten" }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    expect((result as any).content).toBe("rewritten");
    expect((await documentRow(documentId)).content).toBe("rewritten");
  });

  it("derives an unguarded body save from the row locked after a racing writer", async () => {
    const documentId = await createDocument({ content: "initial body" });
    const initial = await documentRow(documentId);
    const db = getDb();
    const originalTransaction = db.transaction.bind(db);
    const racingUpdatedAt = new Date(
      new Date(initial.updatedAt).getTime() + 1_000,
    ).toISOString();
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementationOnce(async (callback: any, config?: any) => {
        await db
          .update(schema.documents)
          .set({
            content: "racing writer body",
            bodyRevision: 7,
            updatedAt: racingUpdatedAt,
          })
          .where(eq(schema.documents.id, documentId));
        return originalTransaction(callback, config);
      });
    try {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({
          id: documentId,
          content: "requested body",
          historySessionId: "unguarded-race",
        }),
      );
    } finally {
      transaction.mockRestore();
    }

    expect(await documentRow(documentId)).toMatchObject({
      content: "requested body",
      bodyRevision: 8,
      updatedAt: new Date(
        new Date(racingUpdatedAt).getTime() + 1,
      ).toISOString(),
    });
    const checkpoints = await db
      .select({ content: schema.documentVersions.content })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId))
      .orderBy(asc(schema.documentVersions.createdAt));
    expect(checkpoints.map((checkpoint: any) => checkpoint.content)).toEqual([
      "racing writer body",
      "requested body",
    ]);
  });

  it("does not revert a concurrent title when an unguarded body save repeats its original title", async () => {
    const documentId = await createDocument({
      title: "Initial title",
      content: "initial body",
    });
    const initial = await documentRow(documentId);
    const db = getDb();
    const originalTransaction = db.transaction.bind(db);
    const racingUpdatedAt = new Date(
      new Date(initial.updatedAt).getTime() + 1_000,
    ).toISOString();
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementationOnce(async (callback: any, config?: any) => {
        await db
          .update(schema.documents)
          .set({ title: "Concurrent title", updatedAt: racingUpdatedAt })
          .where(eq(schema.documents.id, documentId));
        return originalTransaction(callback, config);
      });
    try {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({
          id: documentId,
          title: "Initial title",
          content: "requested body",
        }),
      );
    } finally {
      transaction.mockRestore();
    }

    expect(await documentRow(documentId)).toMatchObject({
      title: "Concurrent title",
      content: "requested body",
    });
  });

  it("CAS-rejects a body that only becomes stale before the row lock", async () => {
    const documentId = await createDocument({
      title: "Initial title",
      content: "initial body",
    });
    const initial = await documentRow(documentId);
    const db = getDb();
    const originalTransaction = db.transaction.bind(db);
    const racingUpdatedAt = new Date(
      new Date(initial.updatedAt).getTime() + 1_000,
    ).toISOString();
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementationOnce(async (callback: any, config?: any) => {
        await db
          .update(schema.documents)
          .set({ content: "racing writer body", updatedAt: racingUpdatedAt })
          .where(eq(schema.documents.id, documentId));
        return originalTransaction(callback, config);
      });
    let result: Awaited<ReturnType<typeof updateDocumentAction.run>>;
    try {
      result = await runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({
          id: documentId,
          title: "Requested title",
          content: "initial body",
          baseUpdatedAt: initial.updatedAt,
        }),
      );
    } finally {
      transaction.mockRestore();
    }

    expect("conflict" in result && result.conflict).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({
      title: "Initial title",
      content: "racing writer body",
      updatedAt: racingUpdatedAt,
    });
  });

  it("applies a content save when baseUpdatedAt matches the current row", async () => {
    const documentId = await createDocument({ content: "original" });
    const before = await documentRow(documentId);

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "updated by matching snapshot",
        baseUpdatedAt: before.updatedAt,
      }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    expect((result as any).content).toBe("updated by matching snapshot");
    expect((await documentRow(documentId)).content).toBe(
      "updated by matching snapshot",
    );
  });

  it("uses the body revision so a metadata-only write does not falsely conflict", async () => {
    const documentId = await createDocument({ content: "original" });
    const before = await documentRow(documentId);
    const baseRevision = `body:${before.bodyRevision}:sha256:${(
      await import("node:crypto")
    )
      .createHash("sha256")
      .update(before.content)
      .digest("hex")}`;

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, icon: "📌" }),
    );
    const afterMetadata = await documentRow(documentId);
    expect(afterMetadata.updatedAt).not.toBe(before.updatedAt);
    expect(afterMetadata.bodyRevision).toBe(before.bodyRevision);

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "local body edit",
        baseUpdatedAt: before.updatedAt,
        baseRevision,
      }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    const updated = await documentRow(documentId);
    expect(updated).toMatchObject({
      content: "local body edit",
      bodyRevision: before.bodyRevision + 1,
    });
    expect(parseIconValue(updated.icon)).toEqual({
      version: 1,
      kind: "emoji",
      emoji: "📌",
    });
  });

  it("rejects a stale opaque body revision even when its counter is forged", async () => {
    const documentId = await createDocument({ content: "original" });
    const before = await documentRow(documentId);
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Must not apply",
        content: "local body edit",
        baseTitle: "Untitled",
        baseRevision: `body:${before.bodyRevision}:sha256:${"0".repeat(64)}`,
      }),
    );

    expect("conflict" in result && result.conflict).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({
      title: "Untitled",
      content: "original",
      bodyRevision: before.bodyRevision,
    });
  });

  it("rejects a combined title and body CAS save without a title baseline", async () => {
    const documentId = await createDocument({
      title: "Original title",
      content: "original",
    });
    const before = await documentRow(documentId);
    const { documentRevisionToken } =
      await import("./_document-edit-mutation.js");

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run({
          id: documentId,
          title: "Local title",
          content: "local body",
          baseRevision: documentRevisionToken(
            before.bodyRevision,
            before.content,
          ),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "BASE_TITLE_REQUIRED" });
    expect(await documentRow(documentId)).toMatchObject({
      title: "Original title",
      content: "original",
    });
  });

  it("does not let a matching body revision overwrite a concurrently changed title", async () => {
    const documentId = await createDocument({
      title: "Original title",
      content: "original",
    });
    const before = await documentRow(documentId);
    const { documentRevisionToken } =
      await import("./_document-edit-mutation.js");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, title: "Concurrent title" }),
    );

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Local title",
        content: "local body",
        baseTitle: "Original title",
        baseRevision: documentRevisionToken(
          before.bodyRevision,
          before.content,
        ),
      }),
    );

    expect("conflict" in result && result.conflict).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({
      title: "Concurrent title",
      content: "original",
    });
  });

  it("does not let a title-only save overwrite a concurrently changed title", async () => {
    const documentId = await createDocument({
      title: "Original title",
      content: "original",
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, title: "Concurrent title" }),
    );

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Local title",
        baseTitle: "Original title",
      }),
    );

    expect("conflict" in result && result.conflict).toBe(true);
    expect(await documentRow(documentId)).toMatchObject({
      title: "Concurrent title",
      content: "original",
    });
  });

  it("rejects a content save when the row moved past baseUpdatedAt and returns the current server document", async () => {
    const documentId = await createDocument({ content: "original" });
    const staleSnapshot = await documentRow(documentId);

    const db = getDb();
    const remoteUpdatedAt = new Date(
      new Date(staleSnapshot.updatedAt).getTime() + 1000,
    ).toISOString();
    await db
      .update(schema.documents)
      .set({ content: "pulled from notion", updatedAt: remoteUpdatedAt })
      .where(eq(schema.documents.id, documentId));

    const result = await measuredSave(
      () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run({
            id: documentId,
            title: "New title from the stale editor",
            content: "editor's stale rewrite",
            baseUpdatedAt: staleSnapshot.updatedAt,
          }),
        ),
      {
        outcome: "conflict",
        stale_base: "true",
        history_effect: "none",
        reason_code: "timestamp_cas_conflict",
      },
    );

    expect("conflict" in result && result.conflict).toBe(true);
    if (!("conflict" in result && result.conflict))
      throw new Error("unreachable");
    expect(result.id).toBe(documentId);
    expect(result.document.content).toBe("pulled from notion");
    expect(result.document.updatedAt).toBe(remoteUpdatedAt);

    const current = await documentRow(documentId);
    expect(current.content).toBe("pulled from notion");
    expect(current.title).toBe("Untitled");
    expect(current.updatedAt).toBe(remoteUpdatedAt);
  });

  it("rejects a stale draft title even when its body matches the current Page", async () => {
    const documentId = await createDocument({ content: "same body" });
    const stale = await documentRow(documentId);
    const newer = new Date(
      new Date(stale.updatedAt).getTime() + 1000,
    ).toISOString();
    await getDb()
      .update(schema.documents)
      .set({ title: "Newer title", updatedAt: newer })
      .where(eq(schema.documents.id, documentId));
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Stale draft title",
        content: "same body",
        baseUpdatedAt: stale.updatedAt,
      }),
    );
    expect("conflict" in result && result.conflict).toBe(true);
    expect((await documentRow(documentId)).title).toBe("Newer title");
  });

  it("does not CAS-guard title/icon-only saves even when baseUpdatedAt is stale", async () => {
    const documentId = await createDocument({ content: "original" });
    const staleSnapshot = await documentRow(documentId);

    const db = getDb();
    const remoteUpdatedAt = new Date(
      new Date(staleSnapshot.updatedAt).getTime() + 1000,
    ).toISOString();
    await db
      .update(schema.documents)
      .set({ content: "pulled from notion", updatedAt: remoteUpdatedAt })
      .where(eq(schema.documents.id, documentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Renamed",
        baseUpdatedAt: staleSnapshot.updatedAt,
      }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    const current = await documentRow(documentId);
    expect(current.title).toBe("Renamed");
    expect(current.content).toBe("pulled from notion");
  });

  it("always snapshots the last nonempty body before an intentional clear", async () => {
    const documentId = await createDocument({ content: "original body" });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "second body within the snapshot interval",
      }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "<empty-block/>",
      }),
    );

    const versions = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    expect(versions.map((version: any) => version.content)).toEqual(
      expect.arrayContaining([
        "original body",
        "second body within the snapshot interval",
      ]),
    );
    expect(versions).toHaveLength(3);
  });

  it("targets a shared editor's update audit event to the document owner", async () => {
    const documentId = await createDocument({ content: "owner body" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: documentId,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });

    const result = await runWithRequestContext({ userEmail: EDITOR }, () =>
      updateDocumentAction.run(
        {
          id: documentId,
          content: "edited by collaborator",
          authoredBaseRevision: documentRevisionToken(0, "owner body"),
          authoredBaseContent: "owner body",
          authoredCandidateContent: "edited by collaborator",
          editorSessionId: nextId("shared-editor-session"),
          editorEditGeneration: 1,
          browserSaveAttemptId: nextId("shared-editor-attempt"),
        },
        {
          caller: "frontend",
          actionName: "update-document",
          userEmail: EDITOR,
        },
      ),
    );
    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const events = await queryAuditEvents(
      { userEmail: OWNER },
      {
        action: "update-document",
        targetType: "document",
        targetId: documentId,
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorEmail: EDITOR,
      ownerEmail: OWNER,
      targetType: "document",
      targetId: documentId,
      status: "success",
    });
    expect(await documentRow(documentId)).toMatchObject({
      createdBy: null,
      updatedBy: EDITOR,
    });
    expect(JSON.stringify(result)).not.toContain(OWNER);
  });

  it("keeps a viewer's favorite preference in the viewer's private audit trail", async () => {
    const documentId = await createDocument({ content: "owner body" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: documentId,
        principalType: "user",
        principalId: VIEWER,
        role: "viewer",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });

    await runWithRequestContext({ userEmail: VIEWER }, () =>
      updateDocumentAction.run(
        { id: documentId, isFavorite: true },
        {
          caller: "frontend",
          actionName: "update-document",
          userEmail: VIEWER,
        },
      ),
    );
    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const viewerEvents = await queryAuditEvents(
      { userEmail: VIEWER },
      {
        action: "update-document",
        targetType: "document",
        targetId: documentId,
      },
    );
    const ownerEvents = await queryAuditEvents(
      { userEmail: OWNER },
      {
        action: "update-document",
        targetType: "document",
        targetId: documentId,
      },
    );

    expect(viewerEvents).toHaveLength(1);
    expect(viewerEvents[0]).toMatchObject({
      actorEmail: VIEWER,
      ownerEmail: VIEWER,
      targetType: "document",
      targetId: documentId,
      status: "success",
    });
    expect(ownerEvents).toHaveLength(0);
  });

  it("preserves separate content and favorite updates without exposing their inputs to the owner", async () => {
    const documentId = await createDocument({ content: "owner body" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: documentId,
        principalType: "user",
        principalId: EDITOR,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });

    await runWithRequestContext({ userEmail: EDITOR }, () =>
      updateDocumentAction.run(
        {
          id: documentId,
          content: "collaborator body",
          authoredBaseRevision: documentRevisionToken(0, "owner body"),
          authoredBaseContent: "owner body",
          authoredCandidateContent: "collaborator body",
          editorSessionId: nextId("favorite-editor-session"),
          editorEditGeneration: 1,
          browserSaveAttemptId: nextId("favorite-editor-attempt"),
        },
        {
          caller: "frontend",
          actionName: "update-document",
          userEmail: EDITOR,
        },
      ),
    );
    await runWithRequestContext({ userEmail: EDITOR }, () =>
      updateDocumentAction.run(
        { id: documentId, isFavorite: true },
        {
          caller: "frontend",
          actionName: "update-document",
          userEmail: EDITOR,
        },
      ),
    );
    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const ownerEvents = await queryAuditEvents(
      { userEmail: OWNER },
      {
        action: "update-document",
        targetType: "document",
        targetId: documentId,
      },
    );

    expect((await documentRow(documentId)).content).toBe("collaborator body");
    expect(ownerEvents).toHaveLength(1);
    expect(ownerEvents[0]).toMatchObject({
      actorEmail: EDITOR,
      ownerEmail: OWNER,
      input: null,
      status: "success",
    });
  });
});

describe("update-document save outcome counts", () => {
  it.each(["changed", "unchanged", "refused"] as const)(
    "does not count a %s personal favorite toggle as a document save",
    async (outcome) => {
      const id = await createDocument({ content: "Body" });
      const invoke = (documentId: string) =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            { id: documentId, isFavorite: true },
            { caller: "frontend", userEmail: OWNER },
          ),
        );
      if (outcome === "unchanged") await invoke(id);
      const before = await documentRow(id);
      await new Promise((resolve) => setTimeout(resolve, 0));
      outcomeCounter.mockClear();
      if (outcome === "refused") {
        await expect(
          invoke(nextId("missing-favorite-document")),
        ).rejects.toThrow();
      } else {
        expect(await invoke(id)).toMatchObject({ isFavorite: true });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(outcomeCounter).not.toHaveBeenCalled();
      expect(await documentRow(id)).toEqual(before);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(0);
    },
  );

  it.each(["baseUpdatedAt", "recoveryExpectedUpdatedAt"] as const)(
    "observes the matching %s key on a successful body write",
    async (field) => {
      const id = await createDocument({ content: "Body" });
      const before = await documentRow(id);
      const result = await measuredSave(
        () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run({
              id,
              content: "Changed body",
              [field]: before.updatedAt,
            }),
          ),
        {
          outcome: "written",
          stale_base: "false",
          history_effect: "transition",
        },
      );
      expect(result).toMatchObject({ content: "Changed body" });
      expect((await documentRow(id)).content).toBe("Changed body");
    },
  );

  it.each(["equivalent", "older"] as const)(
    "observes the %s loaded timestamp with the existing empty-body guard",
    async (base) => {
      const id = await createDocument({ content: "Hydrated body" });
      const before = await documentRow(id);
      const result = await measuredSave(
        () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run(
              {
                id,
                content: "<empty-block/>",
                baseRevision: documentRevisionToken(
                  before.bodyRevision,
                  before.content,
                ),
                authoredBaseRevision: documentRevisionToken(
                  before.bodyRevision,
                  before.content,
                ),
                authoredBaseContent: before.content,
                authoredCandidateContent: "<empty-block/>",
                editorSessionId: nextId("loaded-time-editor"),
                editorEditGeneration: 1,
                loadedUpdatedAt:
                  base === "equivalent"
                    ? before.updatedAt.replace("Z", "+00:00")
                    : "2020-01-01T00:00:00.000Z",
                loadedContentWasEmpty: false,
                browserSaveAttemptId: nextId("loaded-time-guard"),
              },
              { caller: "frontend", userEmail: OWNER },
            ),
          ),
        {
          outcome: base === "equivalent" ? "written" : "conflict",
          stale_base: base === "equivalent" ? "false" : "true",
          history_effect: base === "equivalent" ? "transition" : "none",
          ...(base === "older" ? { reason_code: "stale_empty_body" } : {}),
        },
      );
      if (base === "equivalent") {
        expect(result).toMatchObject({ content: "<empty-block/>" });
        expect((await documentRow(id)).content).toBe("<empty-block/>");
      } else {
        expect(result).toMatchObject({ conflict: true });
        expect(await documentRow(id)).toEqual(before);
        expect(
          await getDb()
            .select()
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.documentId, id)),
        ).toHaveLength(0);
      }
    },
  );

  it.each(
    (["baseUpdatedAt", "recoveryExpectedUpdatedAt"] as const).flatMap((field) =>
      (["equivalent", "submillisecond"] as const).map((format) => ({
        field,
        format,
      })),
    ),
  )(
    "observes the rejected $format $field key on a body write",
    async ({ field, format }) => {
      const id = await createDocument({ content: "Body" });
      const before = await documentRow(id);
      const timestamp = before.updatedAt.replace(
        "Z",
        format === "equivalent" ? "+00:00" : "1Z",
      );
      expect(Date.parse(timestamp)).toBe(Date.parse(before.updatedAt));
      const result = await measuredSave(
        () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run({
              id,
              content: "Changed body",
              [field]: timestamp,
            }),
          ),
        {
          outcome: "conflict",
          stale_base: "true",
          history_effect: "none",
          reason_code:
            field === "baseUpdatedAt"
              ? "timestamp_cas_conflict"
              : "recovery_base_changed",
        },
      );
      expect(result).toMatchObject({ conflict: true });
      expect(await documentRow(id)).toEqual(before);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(0);
    },
  );

  it.each(
    (
      ["baseUpdatedAt", "loadedUpdatedAt", "recoveryExpectedUpdatedAt"] as const
    ).flatMap((field) =>
      (
        ["malformed", "numeric", "invalid-date", "equivalent", "stale"] as const
      ).map((base) => ({
        field,
        base,
      })),
    ),
  )(
    "observes a $base $field timestamp without writing",
    async ({ field, base }) => {
      const id = await createDocument({ content: "Body" });
      const before = await documentRow(id);
      const timestamp =
        base === "malformed"
          ? "not-a-timestamp"
          : base === "numeric"
            ? "5"
            : base === "invalid-date"
              ? "2026-02-30T00:00:00.000Z"
              : base === "equivalent"
                ? before.updatedAt.replace("Z", "+00:00")
                : "2020-01-01T00:00:00.000Z";
      await measuredSave(
        () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run(
              { id, content: "Body", [field]: timestamp },
              { caller: "frontend", userEmail: OWNER },
            ),
          ),
        {
          outcome: "unchanged",
          stale_base:
            base === "malformed" ||
            base === "numeric" ||
            base === "invalid-date"
              ? "unknown"
              : base === "equivalent" && field === "loadedUpdatedAt"
                ? "false"
                : "true",
          history_effect: "none",
        },
      );
      expect(await documentRow(id)).toEqual(before);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(0);
    },
  );

  it.each(["current", "stale"] as const)(
    "observes an unchanged save's %s loaded timestamp without writing",
    async (base) => {
      const id = await createDocument({ content: "Body" });
      const before = await documentRow(id);
      await measuredSave(
        () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run(
              {
                id,
                content: "Body",
                loadedUpdatedAt:
                  base === "current"
                    ? before.updatedAt
                    : "2020-01-01T00:00:00.000Z",
              },
              { caller: "frontend", userEmail: OWNER },
            ),
          ),
        {
          outcome: "unchanged",
          stale_base: base === "current" ? "false" : "true",
          history_effect: "none",
        },
      );
      expect(await documentRow(id)).toEqual(before);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(0);
    },
  );

  it.each(["current", "stale"] as const)(
    "observes a suppressed empty snapshot as stale with only a %s loaded timestamp",
    async (base) => {
      const id = await createDocument({ content: "Hydrated body" });
      const before = await documentRow(id);
      const result = await measuredSave(
        () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run(
              {
                id,
                content: "<empty-block/>",
                loadedContentWasEmpty: true,
                loadedUpdatedAt:
                  base === "current"
                    ? before.updatedAt
                    : "2020-01-01T00:00:00.000Z",
                browserSaveAttemptId: nextId("loaded-empty-attempt"),
              },
              { caller: "frontend", userEmail: OWNER },
            ),
          ),
        {
          outcome: "conflict",
          stale_base: "true",
          history_effect: "none",
          reason_code: "stale_empty_body",
        },
      );
      expect(result).toMatchObject({
        conflict: true,
        document: { content: "Hydrated body" },
      });
      expect(await documentRow(id)).toEqual(before);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(0);
    },
  );

  it.each([false, true])(
    "does not treat a malformed base as stale (body changes: %s)",
    async (bodyChanges) => {
      const id = await createDocument({ title: "Page", content: "Body" });
      const before = await documentRow(id);
      await measuredSave(
        async () => {
          const saved = runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run(
              {
                id,
                content: bodyChanges ? "Changed body" : "Body",
                baseRevision: "invalid-token",
              },
              { caller: "http", userEmail: OWNER },
            ),
          );
          if (bodyChanges)
            await expect(saved).rejects.toMatchObject({
              errorCode: "INVALID_BASE_REVISION",
            });
          else expect((await saved).content).toBe("Body");
        },
        {
          outcome: bodyChanges ? "refused" : "unchanged",
          stale_base: "unknown",
          history_effect: "none",
          ...(bodyChanges ? { reason_code: "INVALID_BASE_REVISION" } : {}),
        },
      );
      expect(await documentRow(id)).toEqual(before);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(0);
    },
  );

  it.each([false, true])(
    "does not reuse a prior audit outcome when a later call fails validation (post-save failure: %s)",
    async (postSaveFailure) => {
      const id = await createDocument({ title: "Before", content: "Body" });
      const appState = await import("@agent-native/core/application-state");
      const error = new Error("injected refresh failure");
      const refresh = postSaveFailure
        ? vi.spyOn(appState, "writeAppState").mockRejectedValueOnce(error)
        : undefined;
      const ctx = {
        caller: "frontend" as const,
        userEmail: OWNER,
        actionName: "update-document",
      };
      try {
        await runWithRequestContext({ userEmail: OWNER }, async () => {
          const saved = updateDocumentAction.run(
            { id, title: "After", baseTitle: "Before" },
            ctx,
          );
          if (postSaveFailure)
            await expect(saved).rejects.toMatchObject({
              errorCode: "DOCUMENT_SAVED_RESPONSE_FAILED",
              details: { id, saved: true },
            });
          else await saved;
          await expect(
            updateDocumentAction.run(
              { id, content: 42 as unknown as string },
              ctx,
            ),
          ).rejects.toThrow();
        });
        expect((await documentRow(id)).title).toBe("After");
        const { queryAuditEvents } = await import("@agent-native/core/audit");
        const events = await queryAuditEvents(
          { userEmail: OWNER },
          {
            action: "update-document",
            targetType: "document",
            targetId: id,
            order: "asc",
          },
        );
        expect(events.map((event) => event.summary)).toEqual([
          `update-document outcome=written document=${id}`,
          `update-document outcome=refused document=${id}`,
        ]);
      } finally {
        refresh?.mockRestore();
      }
    },
  );

  it.each(["frontend", "http"] as const)(
    "counts a %s save-separately recovery copy once with no History transition on creation",
    async (caller) => {
      const resolveDraft = (await import("./resolve-preview-document-draft.js"))
        .default;
      const id = await createDocument({ title: "Page", content: "Body" });
      const before = await documentRow(id);
      await getDb()
        .insert(schema.documentPreviewDrafts)
        .values({
          id: nextId("separate-draft"),
          ownerEmail: OWNER,
          orgId: "",
          documentId: id,
          title: "Recovered page",
          content: "Recovered body",
          baseDocumentUpdatedAt: before.updatedAt,
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
      outcomeCounter.mockClear();
      const request = {
        choice: "save_separately" as const,
        documentId: id,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Recovered page",
        expectedDraftContent: "Recovered body",
        expectedDocumentUpdatedAt: before.updatedAt,
      };
      const invoke = () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          resolveDraft.run(request, { caller, userEmail: OWNER }),
        );
      const first = await invoke();
      const replay = await invoke();
      expect(first).toMatchObject({
        status: "resolved",
        choice: "save_separately",
      });
      expect(replay.document.id).toBe(first.document.id);
      expect((await documentRow(first.document.id)).content).toBe(
        "Recovered body",
      );
      expect((await documentRow(id)).content).toBe("Body");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(outcomeCounter).toHaveBeenCalledExactlyOnceWith(
        "content_save_outcome_counts",
        {
          operation: "create_document",
          outcome: "written",
          origin: "recovery",
          stale_base: "unknown",
          history_effect: "none",
        },
      );
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, first.document.id)),
      ).toHaveLength(0);
    },
  );

  it("classifies a current-body save as written even when an unused title base is stale", async () => {
    const id = await createDocument({
      title: "Canonical title",
      content: "Body",
    });
    const revision = documentRevisionToken(0, "Body");
    await measuredSave(
      () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              title: "Canonical title",
              baseTitle: "Earlier title",
              content: "Changed body",
              baseRevision: revision,
              authoredBaseRevision: revision,
              authoredBaseContent: "Body",
              authoredCandidateContent: "Changed body",
              editorSessionId: nextId("current-body-session"),
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("current-body-attempt"),
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        ),
      {
        outcome: "written",
        stale_base: "true",
        history_effect: "transition",
      },
    );
  });

  it("keeps the committed outcome in counters and audit when post-save refresh fails", async () => {
    const appState = await import("@agent-native/core/application-state");
    const error = new Error("injected refresh failure");
    const refresh = vi
      .spyOn(appState, "writeAppState")
      .mockRejectedValueOnce(error);
    const id = await createDocument({ title: "Before", content: "Body" });
    try {
      await measuredSave(
        async () => {
          await expect(
            runWithRequestContext({ userEmail: OWNER }, () =>
              updateDocumentAction.run(
                {
                  id,
                  title: "After",
                  baseTitle: "Before",
                },
                {
                  caller: "frontend",
                  userEmail: OWNER,
                  actionName: "update-document",
                },
              ),
            ),
          ).rejects.toMatchObject({
            errorCode: "DOCUMENT_SAVED_RESPONSE_FAILED",
            details: { id, saved: true },
          });
        },
        { outcome: "written", history_effect: "transition" },
      );
      expect((await documentRow(id)).title).toBe("After");
      const { queryAuditEvents } = await import("@agent-native/core/audit");
      const events = await queryAuditEvents(
        { userEmail: OWNER },
        {
          action: "update-document",
          targetType: "document",
          targetId: id,
        },
      );
      expect(events[0]).toMatchObject({
        status: "success",
        summary: `update-document outcome=written document=${id}`,
      });
    } finally {
      refresh.mockRestore();
    }
  });

  it("reports actual transitions and preservation together for a partially displaced merge", async () => {
    const base = "Shared passage\nOther passage";
    const id = await createDocument({ content: base });
    const revision = documentRevisionToken(0, base);
    await runWithRequestContext({ userEmail: OWNER }, () =>
      editDocumentAction.run(
        {
          id,
          baseRevision: revision,
          idempotencyKey: nextId("agent-partial-overlap"),
          find: "Shared passage",
          replace: "Agent passage",
        },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const candidate = "Browser passage\nBrowser other passage";
    const saved = await measuredSave(
      () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              content: candidate,
              baseRevision: revision,
              authoredBaseRevision: revision,
              authoredBaseContent: base,
              authoredCandidateContent: candidate,
              editorSessionId: nextId("partially-displaced-session"),
              editorEditGeneration: 1,
              browserSaveAttemptId: nextId("partially-displaced-attempt"),
            },
            {
              caller: "frontend",
              userEmail: OWNER,
              actionName: "update-document",
            },
          ),
        ),
      {
        outcome: "merged_with_displaced_text",
        stale_base: "true",
        history_effect: "transition_and_preservation",
      },
    );
    expect(saved.content).toBe("Agent passage\nBrowser other passage");
    expect((await documentRow(id)).content).toBe(saved.content);
    const { queryAuditEvents } = await import("@agent-native/core/audit");
    const events = await queryAuditEvents(
      { userEmail: OWNER },
      {
        action: "update-document",
        targetType: "document",
        targetId: id,
      },
    );
    expect(events[0].summary).toBe(
      `update-document outcome=merged_with_displaced_text document=${id}`,
    );
  });

  it("counts nested draft recovery only at its inner save", async () => {
    const resolveDraft = (await import("./resolve-preview-document-draft.js"))
      .default;
    const id = await createDocument({ title: "Page", content: "Body" });
    const before = await documentRow(id);
    await getDb()
      .insert(schema.documentPreviewDrafts)
      .values({
        id: nextId("nested-draft"),
        ownerEmail: OWNER,
        orgId: "",
        documentId: id,
        title: "Page",
        content: "Recovered body",
        baseDocumentUpdatedAt: before.updatedAt,
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    outcomeCounter.mockClear();
    const request = {
      choice: "keep_mine" as const,
      documentId: id,
      expectedDraftVersion: 1,
      expectedDraftTitle: "Page",
      expectedDraftContent: "Recovered body",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const invoke = () =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        resolveDraft.run(request, { caller: "frontend", userEmail: OWNER }),
      );
    expect(await invoke()).toMatchObject({ status: "resolved" });
    expect(await invoke()).toMatchObject({ status: "resolved" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcomeCounter).toHaveBeenCalledExactlyOnceWith(
      "content_save_outcome_counts",
      {
        operation: "update_document",
        outcome: "written",
        origin: "recovery",
        stale_base: "false",
        history_effect: "transition",
      },
    );
    expect((await documentRow(id)).content).toBe("Recovered body");
  });

  it("reclassifies a rolled-back preservation as the concurrently committed replay", async () => {
    const receipts = await import("./_browser-document-save-attempt.js");
    const id = await createDocument({ title: "Page", content: "Body" });
    const before = await documentRow(id);
    const args = {
      id,
      content: "Unlineaged candidate",
      browserSaveAttemptId: nextId("rollback-attempt"),
    };
    const db = getDb();
    const originalTransaction = db.transaction.bind(db);
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementation((callback: any) =>
        originalTransaction(async (tx: any) => {
          await callback(tx);
          throw new Error("injected concurrent receipt collision");
        }),
      );
    const originalLookup = receipts.findBrowserSaveAttempt;
    const parsedArgs =
      await updateDocumentAction.schema["~standard"].validate(args);
    if (parsedArgs.issues) throw new Error("Invalid rollback fixture");
    let lookups = 0;
    const lookup = vi
      .spyOn(receipts, "findBrowserSaveAttempt")
      .mockImplementation(async (input) => {
        lookups += 1;
        if (lookups < 3) return originalLookup(input);
        return {
          attemptId: args.browserSaveAttemptId,
          payloadDigest: receipts.browserSavePayloadDigest(parsedArgs.value),
          resultJson: JSON.stringify({
            kind: "preservation-required",
            revision: documentRevisionToken(0, "Body"),
            updatedAt: before.updatedAt,
            reason: "provenance",
            checkpointId: "concurrent-checkpoint",
          }),
        };
      });
    try {
      const replay = await measuredSave(
        () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run(args, {
              caller: "frontend",
              userEmail: OWNER,
            }),
          ),
        {
          outcome: "replayed",
          stale_base: "unknown",
          history_effect: "none",
        },
      );
      expect(replay).toMatchObject({
        preservationRequired: true,
        checkpointId: "concurrent-checkpoint",
      });
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(0);
      expect(outcomeCounter.mock.calls[0][1]).not.toHaveProperty("reason_code");
    } finally {
      lookup.mockRestore();
      transaction.mockRestore();
    }
  });

  it.each(["current", "stale", "absent"] as const)(
    "classifies an unchanged save's %s base without writing History",
    async (base) => {
      const id = await createDocument({ title: "Page", content: "Body" });
      const before = await documentRow(id);
      const saved = await measuredSave(
        () =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run(
              {
                id,
                content: "Body",
                ...(base === "absent"
                  ? {}
                  : {
                      baseRevision: documentRevisionToken(
                        0,
                        base === "current" ? "Body" : "Older body",
                      ),
                    }),
              },
              { caller: "frontend", userEmail: OWNER },
            ),
          ),
        {
          outcome: "unchanged",
          stale_base:
            base === "absent" ? "unknown" : base === "stale" ? "true" : "false",
          history_effect: "none",
        },
      );
      expect(saved.content).toBe("Body");
      expect(await documentRow(id)).toEqual(before);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, id)),
      ).toHaveLength(0);
    },
  );

  it("classifies a known stale base on an early stale-body conflict without writing", async () => {
    const id = await createDocument({ content: "Hydrated body" });
    const before = await documentRow(id);
    const saved = await measuredSave(
      () =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          updateDocumentAction.run(
            {
              id,
              content: "",
              baseRevision: documentRevisionToken(0, ""),
              loadedContentWasEmpty: true,
              loadedUpdatedAt: "2020-01-01T00:00:00.000Z",
              browserSaveAttemptId: nextId("stale-attempt"),
            },
            { caller: "frontend", userEmail: OWNER },
          ),
        ),
      {
        outcome: "conflict",
        stale_base: "true",
        history_effect: "none",
        reason_code: "stale_empty_body",
      },
    );
    expect(saved).toMatchObject({ conflict: true });
    expect(await documentRow(id)).toEqual(before);
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id)),
    ).toHaveLength(0);
  });

  it("counts unchanged, stale conflict, refusal and superseded saves once", async () => {
    const id = await createDocument({ title: "Page", content: "Body" });
    const frontend = { caller: "frontend" as const, userEmail: OWNER };
    const invoke = (args: Parameters<typeof updateDocumentAction.run>[0]) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, frontend),
      );
    await measuredSave(() => invoke({ id, title: "Page" }), {
      outcome: "unchanged",
      history_effect: "none",
    });
    await measuredSave(
      () => invoke({ id, title: "Changed", baseTitle: "Stale title" }),
      {
        outcome: "conflict",
        history_effect: "none",
        reason_code: "title_base_changed",
      },
    );
    await measuredSave(
      async () => {
        await expect(
          invoke({ id, editorSessionId: "incomplete" }),
        ).rejects.toMatchObject({
          errorCode: "INVALID_EDITOR_EDIT_IDENTITY",
        });
      },
      {
        outcome: "refused",
        history_effect: "none",
        reason_code: "INVALID_EDITOR_EDIT_IDENTITY",
      },
    );
    const editorSessionId = nextId("discarded-session");
    await getDb()
      .insert(schema.documentPreviewDraftSettlements)
      .values({
        id: nextId("discarded-settlement"),
        ownerEmail: OWNER,
        orgId: "",
        documentId: id,
        editorSessionId,
        settledGeneration: 2,
        discardedGeneration: 2,
      });
    const superseded = await measuredSave(
      () =>
        invoke({
          id,
          title: "Discarded",
          editorSessionId,
          editorEditGeneration: 1,
        }),
      { outcome: "superseded", history_effect: "none" },
    );
    expect(superseded).toMatchObject({ superseded: true });
    expect((await documentRow(id)).title).toBe("Page");
  });

  it("keeps recovery context outside the hashed payload and gives keepalive/flush replays no History effect", async () => {
    const id = await createDocument({ title: "Page", content: "Body" });
    const args = {
      id,
      title: "Recovery title",
      browserSaveAttemptId: nextId("recovery-attempt"),
    };
    const invoke = (recovery: boolean) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        updateDocumentAction.run(args, {
          caller: "frontend",
          userEmail: OWNER,
          ...(recovery
            ? {
                requestHeaders: new Headers({
                  "X-Content-Save-Origin": "recovery",
                }),
              }
            : {}),
        }),
      );
    const saved = await measuredSave(() => invoke(true), {
      outcome: "written",
      origin: "recovery",
      history_effect: "transition",
    });
    const replay = await measuredSave(() => invoke(false), {
      outcome: "replayed",
      origin: "browser",
      history_effect: "none",
    });
    expect(replay.browserSaveAttempt?.result).toBe("replayed");
    expect(replay.revision).toBe(saved.revision);
    expect(
      await getDb()
        .select()
        .from(schema.documentBrowserSaveAttempts)
        .where(eq(schema.documentBrowserSaveAttempts.documentId, id)),
    ).toHaveLength(1);
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id)),
    ).toHaveLength(2);
  });

  it.each(["throws", "rejects", "never settles"])(
    "preserves real save results and ordering when telemetry %s",
    async (failure) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      outcomeCounter.mockClear();
      outcomeCounter.mockImplementation(() => {
        if (failure === "throws") throw new Error("provider failed");
        if (failure === "rejects")
          return Promise.reject(new Error("provider failed"));
        return new Promise(() => {});
      });
      try {
        const id = await createDocument({ title: "Before", content: "Body" });
        const invoke = (title: string, baseTitle: string) =>
          runWithRequestContext({ userEmail: OWNER }, () =>
            updateDocumentAction.run(
              { id, title, baseTitle },
              { caller: "frontend", userEmail: OWNER },
            ),
          );
        const first = await invoke("First", "Before");
        expect(first.title).toBe("First");
        const second = await invoke("Second", "First");
        expect(second.title).toBe("Second");
        expect(new Date(second.updatedAt).getTime()).toBeGreaterThan(
          new Date(first.updatedAt).getTime(),
        );
        expect((await documentRow(id)).title).toBe("Second");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(outcomeCounter).toHaveBeenCalledTimes(2);
      } finally {
        outcomeCounter.mockReset();
      }
    },
  );
});
