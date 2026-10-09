import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-widget-share-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "widget-share-owner@example.com";
const ADMIN = "widget-share-admin@example.com";
const EDITOR = "widget-share-editor@example.com";
const COMMENTER = "widget-share-commenter@example.com";
const VIEWER = "widget-share-viewer@example.com";
const RECIPIENT = "widget-share-recipient@example.com";
const EXISTING_SHARE = "widget-share-existing@example.com";
const DOCUMENT_ID = "widget-share-document";
const FOREIGN_DOCUMENT_ID = "widget-share-foreign-document";
const FOREIGN_OWNER = "widget-share-foreign-owner@example.com";

type ShareAction = { run: (args: any, context?: any) => Promise<any> };
type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let shareResource: ShareAction;
let unshareResource: ShareAction;
let setResourceVisibility: ShareAction;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  shareResource = (
    await import("@agent-native/core/sharing/actions/share-resource")
  ).default as ShareAction;
  unshareResource = (
    await import("@agent-native/core/sharing/actions/unshare-resource")
  ).default as ShareAction;
  setResourceVisibility = (
    await import("@agent-native/core/sharing/actions/set-resource-visibility")
  ).default as ShareAction;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  const now = new Date().toISOString();
  const document = (id: string, ownerEmail: string) => ({
    id,
    ownerEmail,
    orgId: null,
    parentId: null,
    title: id,
    content: "",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .insert(schema.documents)
    .values([
      document(DOCUMENT_ID, OWNER),
      document(FOREIGN_DOCUMENT_ID, FOREIGN_OWNER),
    ]);
  const grant = (resourceId: string, principalId: string, role: string) => ({
    id: `${resourceId}-${role}`,
    resourceId,
    principalType: "user",
    principalId,
    role,
    createdBy: OWNER,
    createdAt: now,
  });
  await getDb()
    .insert(schema.documentShares)
    .values([
      grant(DOCUMENT_ID, ADMIN, "admin"),
      grant(DOCUMENT_ID, EDITOR, "editor"),
      grant(DOCUMENT_ID, COMMENTER, "commenter"),
      grant(DOCUMENT_ID, VIEWER, "viewer"),
      grant(FOREIGN_DOCUMENT_ID, OWNER, "viewer"),
    ]);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

// The context the action route builds for a document widget's write ticket.
function widgetWriteContext(userEmail: string) {
  return {
    caller: "mcp-widget-write" as const,
    userEmail,
    mcpDirectoryWidgetWrite: {
      appId: "content",
      resourceIds: { documentId: DOCUMENT_ID, resourceType: "document" },
      actionNames: [
        "update-document",
        "share-resource",
        "unshare-resource",
        "set-resource-visibility",
      ],
    },
  };
}

function asWidget<T>(
  userEmail: string,
  action: ShareAction,
  args: Record<string, unknown>,
): Promise<T> {
  return runWithRequestContext({ userEmail }, () =>
    action.run(args, widgetWriteContext(userEmail)),
  );
}

const shareArgs = (principalId: string, resourceId = DOCUMENT_ID) => ({
  resourceType: "document",
  resourceId,
  principalType: "user" as const,
  principalId,
  role: "viewer" as const,
  notify: false,
});
const unshareArgs = (principalId: string, resourceId = DOCUMENT_ID) => ({
  resourceType: "document",
  resourceId,
  principalType: "user" as const,
  principalId,
});
const visibilityArgs = (visibility: string, resourceId = DOCUMENT_ID) => ({
  resourceType: "document",
  resourceId,
  visibility,
});

async function sharesFor(principalId: string, resourceId = DOCUMENT_ID) {
  return getDb()
    .select()
    .from(schema.documentShares)
    .where(
      and(
        eq(schema.documentShares.resourceId, resourceId),
        eq(schema.documentShares.principalId, principalId),
      ),
    );
}

async function visibilityOf(id: string) {
  const [row] = await getDb()
    .select({ visibility: schema.documents.visibility })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row?.visibility;
}

async function seedExistingShare() {
  await getDb()
    .delete(schema.documentShares)
    .where(eq(schema.documentShares.principalId, EXISTING_SHARE));
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `existing-${Math.random().toString(36).slice(2, 10)}`,
      resourceId: DOCUMENT_ID,
      principalType: "user",
      principalId: EXISTING_SHARE,
      role: "viewer",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
}

describe("document share actions under a widget write grant", () => {
  it.each([
    ["owner", OWNER],
    ["admin-share user", ADMIN],
  ])(
    "lets the %s share, unshare, and change visibility",
    async (_role, email) => {
      await expect(
        asWidget(email, shareResource, shareArgs(RECIPIENT)),
      ).resolves.toMatchObject({ updated: false });
      expect(await sharesFor(RECIPIENT)).toHaveLength(1);

      await expect(
        asWidget(email, unshareResource, unshareArgs(RECIPIENT)),
      ).resolves.toMatchObject({ ok: true });
      expect(await sharesFor(RECIPIENT)).toHaveLength(0);

      await expect(
        asWidget(email, setResourceVisibility, visibilityArgs("public")),
      ).resolves.toMatchObject({ ok: true, visibility: "public" });
      expect(await visibilityOf(DOCUMENT_ID)).toBe("public");
      await asWidget(email, setResourceVisibility, visibilityArgs("private"));
      expect(await visibilityOf(DOCUMENT_ID)).toBe("private");
    },
  );

  it.each([
    ["editor-share user", EDITOR],
    ["commenter-share user", COMMENTER],
    ["viewer-share user", VIEWER],
  ])("rejects the %s and changes nothing", async (_role, email) => {
    await seedExistingShare();
    const forbidden = { name: "ForbiddenError", statusCode: 403 };

    await expect(
      asWidget(email, shareResource, shareArgs(RECIPIENT)),
    ).rejects.toMatchObject(forbidden);
    expect(await sharesFor(RECIPIENT)).toHaveLength(0);

    await expect(
      asWidget(email, unshareResource, unshareArgs(EXISTING_SHARE)),
    ).rejects.toMatchObject(forbidden);
    expect(await sharesFor(EXISTING_SHARE)).toHaveLength(1);

    await expect(
      asWidget(email, setResourceVisibility, visibilityArgs("public")),
    ).rejects.toMatchObject(forbidden);
    expect(await visibilityOf(DOCUMENT_ID)).toBe("private");
  });

  it("still requires admin on a document the grant does not name", async () => {
    // The route binds resourceId to the ticketed document; the actions must
    // hold the same line even if a call reached them with another id.
    const forbidden = { name: "ForbiddenError", statusCode: 403 };

    await expect(
      asWidget(OWNER, shareResource, shareArgs(RECIPIENT, FOREIGN_DOCUMENT_ID)),
    ).rejects.toMatchObject(forbidden);
    await expect(
      asWidget(OWNER, unshareResource, unshareArgs(OWNER, FOREIGN_DOCUMENT_ID)),
    ).rejects.toMatchObject(forbidden);
    await expect(
      asWidget(
        OWNER,
        setResourceVisibility,
        visibilityArgs("public", FOREIGN_DOCUMENT_ID),
      ),
    ).rejects.toMatchObject(forbidden);
    expect(await sharesFor(RECIPIENT, FOREIGN_DOCUMENT_ID)).toHaveLength(0);
    expect(await sharesFor(OWNER, FOREIGN_DOCUMENT_ID)).toHaveLength(1);
    expect(await visibilityOf(FOREIGN_DOCUMENT_ID)).toBe("private");
  });
});
