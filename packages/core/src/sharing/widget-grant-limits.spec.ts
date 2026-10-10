import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { ActionRunContext } from "../action.js";
import { table, text, ownableColumns } from "../db/schema.js";
import { runWithRequestContext } from "../server/request-context.js";
import { ForbiddenError } from "./access.js";
import listResourceShares from "./actions/list-resource-shares.js";
import setResourceVisibility from "./actions/set-resource-visibility.js";
import shareResource from "./actions/share-resource.js";
import unshareResource from "./actions/unshare-resource.js";
import { registerShareableResource } from "./registry.js";
import { createSharesTable } from "./schema.js";
import {
  assertWidgetShareReadGrant,
  assertWidgetShareWriteGrant,
  widgetShareMessage,
} from "./widget-grant.js";

const sent = vi.hoisted(() => [] as Array<{ to: string; text?: string }>);

vi.mock("../server/email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/email.js")>()),
  isEmailConfigured: async () => true,
  sendEmail: async (message: { to: string; text?: string }) => {
    sent.push(message);
    return { status: "sent" };
  },
}));
vi.mock("../user-profile/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../user-profile/store.js")>()),
  getUserProfile: async () => ({ name: "The Owner" }),
}));

const NOTE = "please look at the secret launch plan";
const ownerEmail = "owner+widget@example.com";
const teammateEmail = "teammate+widget@example.com";
const documentId = "doc-a";
const otherDocumentId = "doc-b";

const grantIds = { documentId, resourceType: "document" };
const document = { resourceType: "document", resourceId: documentId };

function widgetContext(
  actionNames = [
    "share-resource",
    "unshare-resource",
    "set-resource-visibility",
  ],
  resourceIds: Record<string, string> = grantIds,
): ActionRunContext {
  return {
    caller: "mcp-widget-write",
    userEmail: ownerEmail,
    mcpDirectoryWidgetWrite: { appId: "content", resourceIds, actionNames },
  };
}

describe("assertWidgetShareWriteGrant: what a widget may hand out", () => {
  const share = (extra: Record<string, unknown> = {}) => ({
    ...document,
    principalType: "user",
    role: "viewer",
    ...extra,
  });

  it.each(["viewer", "commenter", "editor"])(
    "lets a widget grant the %s role to a person",
    (role) => {
      expect(() =>
        assertWidgetShareWriteGrant(
          widgetContext(),
          "share-resource",
          share({ role }),
        ),
      ).not.toThrow();
    },
  );

  it("refuses the admin role from a widget", () => {
    expect(() =>
      assertWidgetShareWriteGrant(
        widgetContext(),
        "share-resource",
        share({ role: "admin" }),
      ),
    ).toThrow(ForbiddenError);
  });

  it.each(["org", "group"])(
    "refuses to share with a %s from a widget",
    (principalType) => {
      expect(() =>
        assertWidgetShareWriteGrant(
          widgetContext(),
          "share-resource",
          share({ principalType }),
        ),
      ).toThrow(ForbiddenError);
    },
  );

  it("holds the same limits for any resource type the grant names", () => {
    const deck = widgetContext(undefined, {
      deckId: "deck-a",
      resourceType: "deck",
    });
    const deckShare = {
      resourceType: "deck",
      resourceId: "deck-a",
      principalType: "user",
    };
    expect(() =>
      assertWidgetShareWriteGrant(deck, "share-resource", {
        ...deckShare,
        role: "editor",
      }),
    ).not.toThrow();
    expect(() =>
      assertWidgetShareWriteGrant(deck, "share-resource", {
        ...deckShare,
        role: "admin",
      }),
    ).toThrow(ForbiddenError);
  });

  it("does not limit what the app itself can grant", () => {
    for (const caller of ["frontend", "agent", "mcp", undefined] as const) {
      expect(() =>
        assertWidgetShareWriteGrant(
          { caller } as ActionRunContext,
          "share-resource",
          share({ role: "admin", principalType: "org" }),
        ),
      ).not.toThrow();
    }
  });

  it("keeps unshare and visibility changes open to everything the Share popover offers", () => {
    for (const principalType of ["user", "org", "group"]) {
      expect(() =>
        assertWidgetShareWriteGrant(widgetContext(), "unshare-resource", {
          ...document,
          principalType,
        }),
      ).not.toThrow();
    }
    // Visibility is chosen in the popover, so none of private, org or public
    // is limited here.
    expect(() =>
      assertWidgetShareWriteGrant(
        widgetContext(),
        "set-resource-visibility",
        document,
      ),
    ).not.toThrow();
  });

  it("still pins the resource and the action before it looks at the grantee", () => {
    expect(() =>
      assertWidgetShareWriteGrant(widgetContext(), "share-resource", {
        ...share(),
        resourceId: otherDocumentId,
      }),
    ).toThrow(ForbiddenError);
    expect(() =>
      assertWidgetShareWriteGrant(
        widgetContext(["unshare-resource"]),
        "share-resource",
        share(),
      ),
    ).toThrow(ForbiddenError);
  });

  it("does not take a database id for the document id", () => {
    const ctx = widgetContext(undefined, {
      documentId,
      databaseId: "db-1",
      resourceType: "document",
    });
    expect(() =>
      assertWidgetShareWriteGrant(ctx, "share-resource", {
        ...share(),
        resourceId: "db-1",
      }),
    ).toThrow(ForbiddenError);
    expect(() =>
      assertWidgetShareReadGrant(
        { caller: "mcp-widget", ...ctx },
        { ...document, resourceId: "db-1" },
      ),
    ).toThrow(ForbiddenError);
  });

  it("refuses a read-only ticket every write action", () => {
    for (const action of [
      "share-resource",
      "unshare-resource",
      "set-resource-visibility",
    ]) {
      expect(() =>
        assertWidgetShareWriteGrant(
          { caller: "mcp-widget", mcpDirectoryWidgetResourceIds: grantIds },
          action,
          share(),
        ),
      ).toThrow(ForbiddenError);
    }
  });
});

describe("widgetShareMessage", () => {
  it("drops the note a widget caller typed", () => {
    expect(widgetShareMessage(widgetContext(), NOTE)).toBeUndefined();
  });

  it("keeps the note for the app and for other callers", () => {
    for (const ctx of [
      undefined,
      { caller: "frontend" },
      { caller: "agent" },
    ] as Array<ActionRunContext | undefined>) {
      expect(widgetShareMessage(ctx, NOTE)).toBe(NOTE);
      expect(widgetShareMessage(ctx, undefined)).toBeUndefined();
    }
  });
});

describe("the share actions under a widget write grant", () => {
  const documents = table("widget_limits_documents", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    ...ownableColumns(),
  });
  const documentShares = createSharesTable("widget_limits_document_shares");
  let pglite: Awaited<ReturnType<typeof createTestPglite>>;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    sent.length = 0;
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE widget_limits_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE widget_limits_document_shares (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        notified_at TEXT
      );
    `);
    db = drizzle(pglite.db);
    registerShareableResource({
      type: "document",
      resourceTable: documents,
      sharesTable: documentShares,
      displayName: "Document",
      titleColumn: "title",
      getDb: () => db,
    });
    await db.insert(documents).values({
      id: documentId,
      title: "A",
      ownerEmail,
      orgId: null,
      visibility: "private",
    });
  });

  afterEach(async () => {
    await pglite.close();
  });

  const shareArgs = (overrides: Record<string, unknown> = {}) => ({
    ...document,
    principalType: "user" as const,
    principalId: teammateEmail,
    role: "viewer" as const,
    notify: true,
    ...overrides,
  });
  const run = (
    action: { run: (args: never, ctx?: ActionRunContext) => unknown },
    args: Record<string, unknown>,
    ctx: ActionRunContext = widgetContext(),
  ) =>
    runWithRequestContext({ userEmail: ownerEmail }, async () =>
      action.run(args as never, ctx),
    );
  const sharesOf = async () =>
    (
      await db
        .select({
          principalId: documentShares.principalId,
          role: documentShares.role,
        })
        .from(documentShares)
        .where(eq(documentShares.resourceId, documentId))
    ).map((share) => `${share.principalId}:${share.role}`);

  it.each([
    ["the admin role", { role: "admin" }],
    ["an organization", { principalType: "org", principalId: "org-1" }],
    ["a group", { principalType: "group", principalId: "group-1" }],
  ])("refuses to share with %s and changes nothing", async (_label, extra) => {
    await expect(run(shareResource, shareArgs(extra))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await sharesOf()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("still shares with a person, notifies them, and leaves the note out of the email", async () => {
    await expect(
      run(shareResource, shareArgs({ role: "editor", message: NOTE })),
    ).resolves.toMatchObject({ updated: false });

    expect(await sharesOf()).toEqual([`${teammateEmail}:editor`]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(teammateEmail);
    expect(sent[0]?.text ?? "").not.toContain(NOTE);
  });

  it("keeps the note for the app's own Share dialog", async () => {
    await run(shareResource, shareArgs({ message: NOTE }), {
      caller: "frontend",
      userEmail: ownerEmail,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text ?? "").toContain(NOTE);
  });

  it("still lets an owner share without notifying, unshare, and change visibility to each level", async () => {
    await run(shareResource, shareArgs({ notify: false }));
    expect(await sharesOf()).toEqual([`${teammateEmail}:viewer`]);
    expect(sent).toEqual([]);

    await run(unshareResource, {
      ...document,
      principalType: "user",
      principalId: teammateEmail,
    });
    expect(await sharesOf()).toEqual([]);

    for (const visibility of ["public", "private"] as const) {
      await expect(
        run(setResourceVisibility, { ...document, visibility }),
      ).resolves.toMatchObject({ ok: true, visibility });
    }
  });

  it("keeps the org share a widget cannot create removable from a widget", async () => {
    await db.insert(documentShares).values({
      id: "org-share",
      resourceId: documentId,
      principalType: "org",
      principalId: "org-1",
      role: "viewer",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    });

    await run(unshareResource, {
      ...document,
      principalType: "org",
      principalId: "org-1",
    });

    expect(await sharesOf()).toEqual([]);
  });

  it("lists shares for the granted document only", async () => {
    await expect(
      run(listResourceShares, document, {
        ...widgetContext(),
        caller: "mcp-widget",
      }),
    ).resolves.toMatchObject({ ownerEmail });
    await expect(
      run(
        listResourceShares,
        { ...document, resourceId: otherDocumentId },
        { ...widgetContext(), caller: "mcp-widget" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
