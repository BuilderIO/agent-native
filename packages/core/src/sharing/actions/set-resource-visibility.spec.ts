import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";
import { table, text, ownableColumns } from "../../db/schema.js";
import { runWithRequestContext } from "../../server/request-context.js";
import { ForbiddenError, resolveAccess } from "../access.js";
import {
  MAX_PUBLIC_FOLLOWERS,
  registerShareableResource,
  type ShareableResourceRegistration,
} from "../registry.js";
import { createSharesTable } from "../schema.js";
import listResourceShares from "./list-resource-shares.js";
import setResourceVisibility from "./set-resource-visibility.js";

const calls = vi.hoisted(() => ({
  tracked: [] as Array<{ properties: unknown; source: unknown }>,
  invalidated: [] as string[],
  notified: [] as Array<{ resourceId: string; before: unknown }>,
  noticeFails: new Set<string>(),
}));

vi.mock("../../tracking/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../tracking/registry.js")>()),
  track: (name: string, properties: unknown, source: unknown) => {
    if (name === "share_visibility_change") {
      calls.tracked.push({ properties, source });
    }
  },
}));

vi.mock("../../server/poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/poll.js")>()),
  invalidateCollabAccessCache: (type: string, resourceId: string) => {
    calls.invalidated.push(`${type}:${resourceId}`);
  },
}));

vi.mock("./extension-change.js", () => ({
  getExtensionShareChangeTargets: async (_type: string, resourceId: string) => [
    `before-${resourceId}`,
  ],
  notifyExtensionShareChanged: async (
    _type: string,
    resourceId: string,
    before: unknown,
  ) => {
    calls.notified.push({ resourceId, before });
    if (calls.noticeFails.has(resourceId)) throw new Error("notice failed");
  },
}));

const resourceType = "visibility-doc";
const ownerEmail = "owner+visibility@example.com";
const adminEmail = "admin+visibility@example.com";
const outsiderEmail = "outsider+visibility@example.com";
const orgId = "org-visibility";

const docs = table("visibility_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(),
});
const docShares = createSharesTable("visibility_doc_shares");

type Visibility = "private" | "org" | "public";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let db: ReturnType<typeof drizzle>;

function register(extra: Partial<ShareableResourceRegistration> = {}) {
  registerShareableResource({
    type: resourceType,
    resourceTable: docs,
    sharesTable: docShares,
    displayName: "Visibility Doc",
    titleColumn: "title",
    getDb: () => db,
    ...extra,
  });
}

/** Writes the update itself, failing for the resources `refuse` names. */
function persistUnless(
  refuse: (resourceId: string, visibility: Visibility) => Error | undefined,
): ShareableResourceRegistration["persistVisibilityChange"] {
  return async ({ resourceId, visibility, update }) => {
    const error = refuse(resourceId, visibility);
    if (error) throw error;
    await db.update(docs).set(update).where(eq(docs.id, resourceId));
  };
}

async function insertDoc(values: {
  id: string;
  title?: string;
  ownerEmail?: string;
  orgId?: string | null;
  visibility?: Visibility;
}) {
  await db.insert(docs).values({
    id: values.id,
    title: values.title ?? values.id,
    ownerEmail: values.ownerEmail ?? ownerEmail,
    orgId: values.orgId === undefined ? orgId : values.orgId,
    visibility: values.visibility ?? "private",
  });
}

async function shareWith(resourceId: string, email: string, role: string) {
  await db.insert(docShares).values({
    id: `share-${resourceId}-${email}`,
    resourceId,
    principalType: "user",
    principalId: email,
    role,
    createdBy: ownerEmail,
    createdAt: new Date().toISOString(),
  } as never);
}

const as = <T>(
  ctx: { userEmail?: string; orgId?: string },
  fn: () => Promise<T>,
) => runWithRequestContext(ctx, fn);

const setOne = (
  resourceId: string,
  visibility: Visibility,
  ctx: { userEmail?: string; orgId?: string } = {
    userEmail: ownerEmail,
    orgId,
  },
) =>
  as(ctx, () =>
    setResourceVisibility.run({ resourceType, resourceId, visibility }),
  ) as Promise<Record<string, any>>;

const batch = (
  resourceIds: string[],
  visibility: Visibility,
  ctx: { userEmail?: string; orgId?: string } = {
    userEmail: ownerEmail,
    orgId,
  },
) =>
  as(ctx, () =>
    setResourceVisibility.run({ resourceType, resourceIds, visibility }),
  ) as Promise<Record<string, any>>;

async function rows() {
  return Object.fromEntries(
    (await db.select().from(docs)).map((row) => [
      row.id,
      { visibility: row.visibility, orgId: row.orgId },
    ]),
  );
}

async function visibilities() {
  return Object.fromEntries(
    Object.entries(await rows()).map(([id, row]) => [id, row.visibility]),
  );
}

function approval(args: {
  resourceId?: string;
  resourceIds?: string[];
  visibility: Visibility;
  role?: "viewer" | "commenter" | "editor";
}) {
  const needsApproval = setResourceVisibility.needsApproval;
  if (typeof needsApproval !== "function") {
    throw new Error("set-resource-visibility approval predicate is missing");
  }
  return as({ userEmail: ownerEmail, orgId }, () =>
    needsApproval({ resourceType, ...args }),
  );
}

beforeEach(async () => {
  calls.tracked.length = 0;
  calls.invalidated.length = 0;
  calls.notified.length = 0;
  calls.noticeFails.clear();
  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE visibility_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE visibility_doc_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      identity_authority TEXT,
      identity_id TEXT
    );
    CREATE TABLE org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      federation_removal_pending_at INTEGER
    );
    CREATE TABLE org_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE workspace_user_groups (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      member_emails_json TEXT NOT NULL DEFAULT '[]',
      created_by_email TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
    );
  `);
  db = drizzle(pglite.db);
  register();
});

afterEach(async () => {
  await pglite.close();
});

describe("set-resource-visibility on one resource", () => {
  it("changes it and returns one card without a per-resource list", async () => {
    await insertDoc({ id: "doc-one", title: "Quarterly plan" });

    const result = await setOne("doc-one", "org");

    expect(result).toEqual({
      ok: true,
      visibility: "org",
      change: {
        verb: "updated",
        kind: "resource-share",
        title: "Quarterly plan",
        detail: "org",
      },
    });
    expect(await visibilities()).toEqual({ "doc-one": "org" });
    expect(calls.tracked).toEqual([
      {
        properties: expect.objectContaining({
          resource_type: resourceType,
          resource_id: "doc-one",
          visibility: "org",
          is_public: false,
        }),
        source: { userId: ownerEmail },
      },
    ]);
    expect(calls.invalidated).toEqual([`${resourceType}:doc-one`]);
    expect(calls.notified).toEqual([
      { resourceId: "doc-one", before: ["before-doc-one"] },
    ]);
  });

  it("returns no card and tracks nothing when it already has that visibility", async () => {
    await insertDoc({ id: "doc-same", visibility: "public" });

    await expect(setOne("doc-same", "public")).resolves.toEqual({
      ok: true,
      visibility: "public",
    });
    expect(calls.tracked).toEqual([]);
  });

  it("marks a public change as public when tracking it", async () => {
    await insertDoc({ id: "doc-out" });

    await setOne("doc-out", "public");

    expect(calls.tracked).toEqual([
      {
        properties: expect.objectContaining({
          visibility: "public",
          is_public: true,
        }),
        source: { userId: ownerEmail },
      },
    ]);
  });

  it("attaches an unscoped resource to the owner's active organization", async () => {
    await insertDoc({ id: "doc-loose", orgId: null });

    await setOne("doc-loose", "org");

    expect(await rows()).toEqual({
      "doc-loose": { visibility: "org", orgId },
    });
  });

  it("lets only the owner attach a resource to an organization", async () => {
    await insertDoc({ id: "doc-shared", orgId: null });
    await shareWith("doc-shared", adminEmail, "admin");

    await expect(
      setOne("doc-shared", "org", { userEmail: adminEmail, orgId }),
    ).rejects.toThrow(
      "Visibility Doc can only be attached to an organization by its owner.",
    );
    expect(await rows()).toEqual({
      "doc-shared": { visibility: "private", orgId: null },
    });
  });

  it("refuses org visibility for an unscoped resource with no active organization", async () => {
    await insertDoc({ id: "doc-loose", orgId: null });

    const refused = setOne("doc-loose", "org", { userEmail: ownerEmail });
    await expect(refused).rejects.toThrow(
      "Visibility Doc cannot be shared with your organization because no active organization is selected.",
    );
    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps an owner's resource unscoped when the registration drops the organization", async () => {
    register({ resolveAccessContext: (ctx) => ({ userEmail: ctx.userEmail }) });
    await insertDoc({ id: "doc-loose", orgId: null });

    await setOne("doc-loose", "org");

    expect(await rows()).toEqual({
      "doc-loose": { visibility: "org", orgId: null },
    });
  });

  it("refuses public visibility for a type that doesn't allow it", async () => {
    register({ allowPublic: false });
    await insertDoc({ id: "doc-closed" });

    const refused = setOne("doc-closed", "public");
    await expect(refused).rejects.toThrow(
      "Visibility Doc cannot be made public — share with specific people or your organization instead.",
    );
    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
    expect(await visibilities()).toEqual({ "doc-closed": "private" });
  });

  it("passes a hook refusal through unchanged", async () => {
    register({
      persistVisibilityChange: persistUnless(
        () => new ForbiddenError("Missing permission: docs.edit"),
      ),
    });
    await insertDoc({ id: "doc-locked", visibility: "public" });

    await expect(setOne("doc-locked", "private")).rejects.toThrow(
      /^Missing permission: docs\.edit$/,
    );
  });
});

describe("set-resource-visibility on several resources", () => {
  it("changes each resource, lists what changed, and shows one card", async () => {
    await insertDoc({ id: "doc-a", visibility: "public" });
    await insertDoc({ id: "doc-b", visibility: "org" });
    await insertDoc({ id: "doc-c" });

    const result = await batch(["doc-a", "doc-b", "doc-c"], "private");

    expect(result).toEqual({
      ok: true,
      visibility: "private",
      changedCount: 2,
      unchangedCount: 1,
      results: [
        { resourceId: "doc-a", status: "changed" },
        { resourceId: "doc-b", status: "changed" },
        { resourceId: "doc-c", status: "unchanged" },
      ],
      change: {
        verb: "updated",
        kind: "resource-share",
        title: "doc-a and 1 more",
        detail: "private",
      },
    });
    expect(await visibilities()).toEqual({
      "doc-a": "private",
      "doc-b": "private",
      "doc-c": "private",
    });
    expect(calls.tracked.map(({ properties }) => properties)).toEqual([
      expect.objectContaining({ resource_id: "doc-a" }),
      expect.objectContaining({ resource_id: "doc-b" }),
    ]);
    // doc-c already had that visibility, so it gets no change notice.
    expect(calls.notified).toEqual([
      { resourceId: "doc-a", before: ["before-doc-a"] },
      { resourceId: "doc-b", before: ["before-doc-b"] },
    ]);
  });

  it("counts an organization attachment as a change", async () => {
    await insertDoc({ id: "doc-scoped", visibility: "org" });
    await insertDoc({ id: "doc-loose", orgId: null, visibility: "org" });

    const result = await batch(["doc-scoped", "doc-loose"], "org");

    expect(result.results).toEqual([
      { resourceId: "doc-scoped", status: "unchanged" },
      { resourceId: "doc-loose", status: "changed" },
    ]);
    expect(result.change.title).toBe("doc-loose");
    expect(calls.tracked).toEqual([]);
  });

  it("still succeeds, and sends the other notices, when one notice fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    calls.noticeFails.add("doc-a");
    await insertDoc({ id: "doc-a" });
    await insertDoc({ id: "doc-b" });

    const result = await batch(["doc-a", "doc-b"], "org");

    expect(result.changedCount).toBe(2);
    expect(await visibilities()).toEqual({ "doc-a": "org", "doc-b": "org" });
    expect(calls.notified.map(({ resourceId }) => resourceId)).toEqual([
      "doc-a",
      "doc-b",
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      `[sharing] Could not send the change notice for ${resourceType} doc-a:`,
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("returns no card when nothing changes", async () => {
    await insertDoc({ id: "doc-a" });
    await insertDoc({ id: "doc-b" });

    const result = await batch(["doc-a", "doc-b"], "private");

    expect(result).toEqual({
      ok: true,
      visibility: "private",
      changedCount: 0,
      unchangedCount: 2,
      results: [
        { resourceId: "doc-a", status: "unchanged" },
        { resourceId: "doc-b", status: "unchanged" },
      ],
    });
  });

  it("names one changed resource without a count", async () => {
    await insertDoc({ id: "doc-a", visibility: "public" });

    const result = await batch(["doc-a"], "private");

    expect(result.change.title).toBe("doc-a");
  });

  it("shortens a long first title to make room for the count", async () => {
    await insertDoc({ id: "doc-long", title: "x".repeat(180) });
    await insertDoc({ id: "doc-short" });
    await insertDoc({ id: "doc-third" });

    const result = await batch(["doc-long", "doc-short", "doc-third"], "org");

    // 180 characters at most: 168 of the title, an ellipsis, " and 2 more".
    expect(result.change.title).toBe(`${"x".repeat(168)}… and 2 more`);
  });

  it("keeps a first title that fits beside the count", async () => {
    const title = "y".repeat(169);
    await insertDoc({ id: "doc-fits", title });
    await insertDoc({ id: "doc-next" });

    const result = await batch(["doc-fits", "doc-next"], "org");

    expect(result.change.title).toBe(`${title} and 1 more`);
  });

  it("treats a resource named twice as one", async () => {
    await insertDoc({ id: "doc-a" });
    await insertDoc({ id: "doc-b" });

    const result = await as({ userEmail: ownerEmail, orgId }, () =>
      setResourceVisibility.run({
        resourceType,
        resourceId: "doc-a",
        resourceIds: ["doc-a", "doc-b", "doc-b"],
        visibility: "org",
      }),
    );

    expect((result as Record<string, any>).results).toEqual([
      { resourceId: "doc-a", status: "changed" },
      { resourceId: "doc-b", status: "changed" },
    ]);
  });

  it("changes nothing, and names the resource, when the caller can't manage one", async () => {
    await insertDoc({ id: "doc-mine", visibility: "public" });
    await insertDoc({
      id: "doc-theirs",
      ownerEmail: outsiderEmail,
      visibility: "public",
    });

    const refused = batch(["doc-mine", "doc-theirs"], "private");
    await expect(refused).rejects.toThrow(
      /^Nothing was changed: 1 of 2 can't change visibility\. doc-theirs: \S/,
    );
    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
    expect(await visibilities()).toEqual({
      "doc-mine": "public",
      "doc-theirs": "public",
    });
    expect(calls.tracked).toEqual([]);
    expect(calls.notified).toEqual([]);
  });

  it("lists every refusal, and is a plain error when one isn't a permission refusal", async () => {
    register({
      assertSharingChange: ({ resource }) => {
        if (resource.id === "doc-odd") throw new Error("odd one out");
        if (resource.id === "doc-held") {
          throw new ForbiddenError("held for review");
        }
      },
    });
    await insertDoc({ id: "doc-ok" });
    await insertDoc({ id: "doc-odd" });
    await insertDoc({ id: "doc-held" });

    const refused = batch(["doc-ok", "doc-odd", "doc-held"], "org");
    await expect(refused).rejects.toThrow(
      "Nothing was changed: 2 of 3 can't change visibility. doc-odd: odd one out; doc-held: held for review",
    );
    await expect(refused).rejects.not.toBeInstanceOf(ForbiddenError);
    expect(await visibilities()).toEqual({
      "doc-ok": "private",
      "doc-odd": "private",
      "doc-held": "private",
    });
  });

  it("checks a sharing change only for resources whose visibility changes", async () => {
    const checked: string[] = [];
    register({
      assertSharingChange: ({ resource, change }) => {
        checked.push(
          `${resource.id}:${resource.visibility}:${change.kind === "visibility" ? change.visibility : change.kind}`,
        );
      },
    });
    await insertDoc({ id: "doc-moves" });
    await insertDoc({ id: "doc-stays", visibility: "org" });

    await batch(["doc-moves", "doc-stays"], "org");

    // Once before the write, against the stored row, and once after it.
    expect(checked).toEqual(["doc-moves:private:org", "doc-moves:org:org"]);
  });

  it("puts back every write when the check after a write refuses", async () => {
    register({
      assertSharingChange: ({ resource }) => {
        if (resource.id === "doc-late" && resource.visibility === "public") {
          throw new ForbiddenError("now holds private content");
        }
      },
    });
    await insertDoc({ id: "doc-early" });
    await insertDoc({ id: "doc-late" });

    const refused = batch(["doc-early", "doc-late"], "public");
    await expect(refused).rejects.toThrow(
      "Nothing was changed: 1 of 2 can't change visibility. doc-late: now holds private content",
    );
    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
    expect(await visibilities()).toEqual({
      "doc-early": "private",
      "doc-late": "private",
    });
  });

  it("puts back resources already written when a later write fails", async () => {
    register({
      persistVisibilityChange: persistUnless((resourceId, visibility) =>
        resourceId === "doc-fails" && visibility === "private"
          ? new Error("storage refused")
          : undefined,
      ),
    });
    await insertDoc({ id: "doc-first", visibility: "public" });
    await insertDoc({ id: "doc-second", visibility: "public" });
    await insertDoc({ id: "doc-fails", visibility: "public" });

    await expect(
      batch(["doc-first", "doc-second", "doc-fails"], "private"),
    ).rejects.toThrow(/^storage refused$/);
    expect(await visibilities()).toEqual({
      "doc-first": "public",
      "doc-second": "public",
      "doc-fails": "public",
    });
    expect(calls.invalidated).toEqual([
      `${resourceType}:doc-second`,
      `${resourceType}:doc-first`,
    ]);
    expect(calls.tracked).toEqual([]);
    expect(calls.notified).toEqual([]);
  });

  it("puts back an organization it attached", async () => {
    register({
      persistVisibilityChange: persistUnless((resourceId) =>
        resourceId === "doc-fails" ? new Error("storage refused") : undefined,
      ),
    });
    await insertDoc({ id: "doc-loose", orgId: null });
    await insertDoc({ id: "doc-fails" });

    await expect(batch(["doc-loose", "doc-fails"], "org")).rejects.toThrow(
      "storage refused",
    );
    expect(await rows()).toEqual({
      "doc-loose": { visibility: "private", orgId: null },
      "doc-fails": { visibility: "private", orgId },
    });
  });

  it("doesn't write a resource that already has the visibility", async () => {
    const written: string[] = [];
    register({
      persistVisibilityChange: persistUnless((resourceId) => {
        written.push(resourceId);
        return resourceId === "doc-same"
          ? new ForbiddenError("Missing permission: docs.edit")
          : undefined;
      }),
    });
    await insertDoc({ id: "doc-moves" });
    await insertDoc({ id: "doc-same", visibility: "org" });

    const result = await batch(["doc-moves", "doc-same"], "org");

    expect(result.results).toEqual([
      { resourceId: "doc-moves", status: "changed" },
      { resourceId: "doc-same", status: "unchanged" },
    ]);
    expect(written).toEqual(["doc-moves"]);
  });

  it("keeps a newer change another request made before the rollback", async () => {
    register({
      persistVisibilityChange: async ({ resourceId, update }) => {
        if (resourceId === "doc-fails") {
          // Someone else moves doc-first on while this batch is mid-write.
          await db
            .update(docs)
            .set({ visibility: "org" })
            .where(eq(docs.id, "doc-first"));
          throw new Error("storage refused");
        }
        await db.update(docs).set(update).where(eq(docs.id, resourceId));
      },
    });
    await insertDoc({ id: "doc-first", visibility: "public" });
    await insertDoc({ id: "doc-fails", visibility: "public" });

    await expect(batch(["doc-first", "doc-fails"], "private")).rejects.toThrow(
      /^storage refused$/,
    );
    expect(await visibilities()).toEqual({
      "doc-first": "org",
      "doc-fails": "public",
    });
    expect(calls.invalidated).toEqual([`${resourceType}:doc-first`]);
  });

  it("keeps, and names, a resource another request moved to another organization before the rollback", async () => {
    register({
      persistVisibilityChange: async ({ resourceId, update }) => {
        if (resourceId === "doc-fails") {
          // Someone else moves doc-loose to another organization, leaving its
          // visibility as this batch wrote it.
          await db
            .update(docs)
            .set({ orgId: "org-other" })
            .where(eq(docs.id, "doc-loose"));
          throw new Error("storage refused");
        }
        await db.update(docs).set(update).where(eq(docs.id, resourceId));
      },
    });
    await insertDoc({ id: "doc-loose", orgId: null });
    await insertDoc({ id: "doc-fails" });

    await expect(batch(["doc-loose", "doc-fails"], "org")).rejects.toThrow(
      'storage refused Not every earlier change could be put back, so these still have visibility "org": doc-loose.',
    );
    expect(await rows()).toEqual({
      "doc-loose": { visibility: "org", orgId: "org-other" },
      "doc-fails": { visibility: "private", orgId },
    });
  });

  it("names a resource still attached to the organization after another request changed its visibility", async () => {
    register({
      persistVisibilityChange: async ({ resourceId, update }) => {
        if (resourceId === "doc-fails") {
          // Someone else makes doc-loose public, keeping the organization
          // this batch attached.
          await db
            .update(docs)
            .set({ visibility: "public" })
            .where(eq(docs.id, "doc-loose"));
          throw new Error("storage refused");
        }
        await db.update(docs).set(update).where(eq(docs.id, resourceId));
      },
    });
    await insertDoc({ id: "doc-loose", orgId: null });
    await insertDoc({ id: "doc-fails" });

    await expect(batch(["doc-loose", "doc-fails"], "org")).rejects.toThrow(
      "storage refused Not every earlier change could be put back, so these are still attached to your organization: doc-loose.",
    );
    expect(await rows()).toEqual({
      "doc-loose": { visibility: "public", orgId },
      "doc-fails": { visibility: "private", orgId },
    });
  });

  it("puts everything back when a resource is deleted after the checks", async () => {
    register({
      // Runs in the up-front checks, before any write.
      assertSharingChange: async ({ resource }) => {
        if (resource.id === "doc-gone") {
          await db.delete(docs).where(eq(docs.id, "doc-gone"));
        }
      },
    });
    await insertDoc({ id: "doc-first" });
    await insertDoc({ id: "doc-gone" });

    await expect(batch(["doc-first", "doc-gone"], "org")).rejects.toThrow(
      "Visibility Doc doc-gone no longer exists.",
    );
    expect(await visibilities()).toEqual({ "doc-first": "private" });
  });

  it("reports a refusal from a persistence hook like one found up front", async () => {
    // Forms checks an org permission inside its hook, after the batch's checks.
    register({
      persistVisibilityChange: persistUnless((resourceId) =>
        resourceId === "doc-locked"
          ? new ForbiddenError("Missing permission: docs.edit")
          : undefined,
      ),
    });
    await insertDoc({ id: "doc-open", visibility: "public" });
    await insertDoc({ id: "doc-locked", visibility: "public" });

    const refused = batch(["doc-open", "doc-locked"], "private");
    await expect(refused).rejects.toThrow(
      "Nothing was changed: 1 of 2 can't change visibility. doc-locked: Missing permission: docs.edit",
    );
    await expect(refused).rejects.toBeInstanceOf(ForbiddenError);
    expect(await visibilities()).toEqual({
      "doc-open": "public",
      "doc-locked": "public",
    });
  });

  it("names the resources it couldn't put back", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    register({
      persistVisibilityChange: persistUnless((resourceId, visibility) => {
        if (resourceId === "doc-fails") return new Error("storage refused");
        if (visibility === "public") return new Error("storage went away");
        return undefined;
      }),
    });
    await insertDoc({ id: "doc-first", visibility: "public" });
    await insertDoc({ id: "doc-second", visibility: "public" });
    await insertDoc({ id: "doc-fails", visibility: "public" });

    const failed = batch(["doc-first", "doc-second", "doc-fails"], "private");
    await expect(failed).rejects.toThrow(
      'storage refused Not every earlier change could be put back, so these still have visibility "private": doc-second, doc-first.',
    );
    expect(await visibilities()).toEqual({
      "doc-first": "private",
      "doc-second": "private",
      "doc-fails": "public",
    });
    expect(consoleError).toHaveBeenCalledWith(
      `[sharing] Could not restore the visibility of ${resourceType} doc-second:`,
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("refuses a widget grant that names only one of the resources", async () => {
    await insertDoc({ id: "doc-granted", visibility: "public" });
    await insertDoc({ id: "doc-other", visibility: "public" });

    await expect(
      as({ userEmail: ownerEmail, orgId }, () =>
        setResourceVisibility.run(
          {
            resourceType,
            resourceIds: ["doc-granted", "doc-other"],
            visibility: "private",
          },
          {
            caller: "mcp-widget-write",
            mcpDirectoryWidgetWrite: {
              actionNames: ["set-resource-visibility"],
              resourceIds: {
                resourceType,
                [`${resourceType}Id`]: "doc-granted",
              },
            },
          } as never,
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await visibilities()).toEqual({
      "doc-granted": "public",
      "doc-other": "public",
    });
  });

  it("refuses more than 100 resources, or none", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => `doc-${i}`);
    const schema = setResourceVisibility.schema;
    expect(
      schema.safeParse({
        resourceType,
        resourceIds: hundred,
        visibility: "org",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        resourceType,
        resourceIds: [...hundred, "doc-100"],
        visibility: "org",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ resourceType, resourceIds: [], visibility: "org" })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ resourceType, visibility: "org" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ resourceType, resourceId: "doc-0", visibility: "org" })
        .success,
    ).toBe(true);

    await expect(
      as({ userEmail: ownerEmail, orgId }, () =>
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-extra",
          resourceIds: hundred,
          visibility: "org",
        }),
      ),
    ).rejects.toThrow(
      "Change at most 100 resources per call; this one named 101.",
    );
    await expect(
      as({ userEmail: ownerEmail, orgId }, () =>
        setResourceVisibility.run({ resourceType, visibility: "org" } as never),
      ),
    ).rejects.toThrow("Provide resourceId or resourceIds.");
  });
});

describe("set-resource-visibility approval", () => {
  it("asks once when any resource would become public", async () => {
    await insertDoc({ id: "doc-private" });
    await insertDoc({ id: "doc-public", visibility: "public" });

    await expect(
      approval({
        resourceIds: ["doc-public", "doc-private"],
        visibility: "public",
      }),
    ).resolves.toBe(true);
    await expect(
      approval({ resourceId: "doc-private", visibility: "public" }),
    ).resolves.toBe(true);
  });

  it("doesn't ask when every resource is already public", async () => {
    await insertDoc({ id: "doc-public", visibility: "public" });
    await insertDoc({ id: "doc-also", visibility: "public" });

    await expect(
      approval({
        resourceIds: ["doc-public", "doc-also"],
        visibility: "public",
      }),
    ).resolves.toBe(false);
  });

  it("doesn't ask for a change that isn't public", async () => {
    await insertDoc({ id: "doc-public", visibility: "public" });

    await expect(
      approval({ resourceIds: ["doc-public"], visibility: "org" }),
    ).resolves.toBe(false);
  });

  it("doesn't ask for a type that can't be made public", async () => {
    register({ allowPublic: false });
    await insertDoc({ id: "doc-private" });

    await expect(
      approval({ resourceId: "doc-private", visibility: "public" }),
    ).resolves.toBe(false);
  });
});

describe("set-resource-visibility organization role", () => {
  const memberEmail = "member+visibility@example.com";

  const setOrg = (
    resourceId: string,
    role: "viewer" | "commenter" | "editor",
  ) =>
    as({ userEmail: ownerEmail, orgId }, () =>
      setResourceVisibility.run({
        resourceType,
        resourceId,
        visibility: "org",
        role,
      }),
    ) as Promise<Record<string, any>>;

  async function orgGrants() {
    return (await db.select().from(docShares))
      .filter((row) => row.principalType === "org")
      .map((row) => ({
        resourceId: row.resourceId,
        principalId: row.principalId,
        role: row.role,
      }));
  }

  async function memberRole(resourceId: string) {
    const access = await as({ userEmail: memberEmail, orgId }, () =>
      resolveAccess(resourceType, resourceId),
    );
    return access?.role ?? null;
  }

  beforeEach(async () => {
    await pglite.exec(`
      INSERT INTO organizations (id, name, created_by, created_at)
      VALUES ('${orgId}', 'Visibility Org', '${ownerEmail}', 0);
      INSERT INTO org_members (id, org_id, email, role, joined_at)
      VALUES ('member-1', '${orgId}', '${memberEmail}', 'member', 0);
    `);
  });

  it("lets everyone in the organization edit", async () => {
    await insertDoc({ id: "doc-edit" });

    const result = await setOrg("doc-edit", "editor");

    expect(result).toMatchObject({
      ok: true,
      visibility: "org",
      role: "editor",
    });
    expect(await visibilities()).toEqual({ "doc-edit": "org" });
    expect(await orgGrants()).toEqual([
      { resourceId: "doc-edit", principalId: orgId, role: "editor" },
    ]);
    expect(await memberRole("doc-edit")).toBe("editor");
  });

  it("goes back to view-only without leaving a grant behind", async () => {
    await insertDoc({ id: "doc-view" });
    await setOrg("doc-view", "editor");

    await setOrg("doc-view", "viewer");

    expect(await orgGrants()).toEqual([]);
    expect(await memberRole("doc-view")).toBe("viewer");
  });

  it("keeps the organization's role when the call names none", async () => {
    await insertDoc({ id: "doc-keep" });
    await setOrg("doc-keep", "commenter");

    await setOne("doc-keep", "org");

    expect(await orgGrants()).toEqual([
      { resourceId: "doc-keep", principalId: orgId, role: "commenter" },
    ]);
  });

  it("removes the organization's role when the resource leaves org", async () => {
    await insertDoc({ id: "doc-leave" });
    await setOrg("doc-leave", "editor");

    await setOne("doc-leave", "private");

    expect(await orgGrants()).toEqual([]);
    expect(await memberRole("doc-leave")).toBeNull();
  });

  it("keeps an organization grant on a resource that was never org", async () => {
    await insertDoc({ id: "doc-granted" });
    await db.insert(docShares).values({
      id: "share-org-granted",
      resourceId: "doc-granted",
      principalType: "org",
      principalId: orgId,
      role: "editor",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    } as never);

    await setOne("doc-granted", "private");

    expect(await orgGrants()).toEqual([
      { resourceId: "doc-granted", principalId: orgId, role: "editor" },
    ]);
  });

  it("puts the visibility back when the organization grant is refused", async () => {
    register({
      assertSharingChange: async ({ change }) => {
        if (change.kind === "grant") throw new ForbiddenError("No grants.");
      },
    });
    await insertDoc({ id: "doc-refused" });

    await expect(setOrg("doc-refused", "editor")).rejects.toThrow("No grants.");

    expect(await visibilities()).toEqual({ "doc-refused": "private" });
    expect(await orgGrants()).toEqual([]);
  });

  it("puts back the role it replaced when a later resource fails", async () => {
    register({
      persistVisibilityChange: persistUnless((resourceId) =>
        resourceId === "doc-b" ? new Error("write failed") : undefined,
      ),
    });
    await insertDoc({ id: "doc-a", visibility: "org" });
    await insertDoc({ id: "doc-b" });
    await db.insert(docShares).values({
      id: "share-org-a",
      resourceId: "doc-a",
      principalType: "org",
      principalId: orgId,
      role: "commenter",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    } as never);

    await expect(
      as({ userEmail: ownerEmail, orgId }, () =>
        setResourceVisibility.run({
          resourceType,
          resourceIds: ["doc-a", "doc-b"],
          visibility: "org",
          role: "editor",
        }),
      ),
    ).rejects.toThrow("write failed");

    expect(await visibilities()).toEqual({
      "doc-a": "org",
      "doc-b": "private",
    });
    expect(await orgGrants()).toEqual([
      { resourceId: "doc-a", principalId: orgId, role: "commenter" },
    ]);
  });

  it("rejects a role for any visibility but org", () => {
    const parsed = setResourceVisibility.schema.safeParse({
      resourceType,
      resourceId: "doc-any",
      visibility: "private",
      role: "editor",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("set-resource-visibility link role", () => {
  const readerEmail = "reader+visibility@example.com";

  const setPublic = (resourceId: string, role?: "viewer" | "commenter") =>
    as({ userEmail: ownerEmail, orgId }, () =>
      setResourceVisibility.run({
        resourceType,
        resourceId,
        visibility: "public",
        ...(role ? { role } : {}),
      }),
    ) as Promise<Record<string, any>>;

  async function grants() {
    return (await db.select().from(docShares)).map((row) => ({
      principalType: row.principalType,
      role: row.role,
    }));
  }

  async function roleOf(resourceId: string, userEmail?: string) {
    const access = await as(userEmail ? { userEmail } : {}, () =>
      resolveAccess(resourceType, resourceId),
    );
    return access?.role ?? null;
  }

  it("lets signed-in people with the link comment", async () => {
    await insertDoc({ id: "doc-link" });

    await setPublic("doc-link", "commenter");

    expect(await visibilities()).toEqual({ "doc-link": "public" });
    expect(await grants()).toEqual([
      { principalType: "link", role: "commenter" },
    ]);
    expect(await roleOf("doc-link", readerEmail)).toBe("commenter");
  });

  it("gives signed-out readers only the view role", async () => {
    await insertDoc({ id: "doc-anon" });
    await setPublic("doc-anon", "commenter");

    expect(await roleOf("doc-anon")).toBe("viewer");
  });

  it("removes the link role when the resource leaves public", async () => {
    await insertDoc({ id: "doc-close" });
    await setPublic("doc-close", "commenter");

    await setOne("doc-close", "private");

    expect(await grants()).toEqual([]);
  });

  it("moves the role from the organization to the link", async () => {
    await insertDoc({ id: "doc-move" });
    await as({ userEmail: ownerEmail, orgId }, () =>
      setResourceVisibility.run({
        resourceType,
        resourceId: "doc-move",
        visibility: "org",
        role: "editor",
      }),
    );

    await setPublic("doc-move", "commenter");

    expect(await grants()).toEqual([
      { principalType: "link", role: "commenter" },
    ]);
  });

  it("refuses edit access for anyone with the link", () => {
    const parsed = setResourceVisibility.schema.safeParse({
      resourceType,
      resourceId: "doc-any",
      visibility: "public",
      role: "editor",
    });

    expect(parsed.success).toBe(false);
  });

  it("asks before anyone with the link can do more", async () => {
    await insertDoc({ id: "doc-public", visibility: "public" });

    await expect(
      approval({
        resourceId: "doc-public",
        visibility: "public",
        role: "commenter",
      }),
    ).resolves.toBe(true);
    await setPublic("doc-public", "commenter");
    await expect(
      approval({
        resourceId: "doc-public",
        visibility: "public",
        role: "commenter",
      }),
    ).resolves.toBe(false);
    await expect(
      approval({
        resourceId: "doc-public",
        visibility: "public",
        role: "viewer",
      }),
    ).resolves.toBe(false);
  });

  it("undoes the link role when the policy refuses it after the write", async () => {
    let grantChecks = 0;
    register({
      assertSharingChange: async ({ change }) => {
        if (change.kind === "grant" && ++grantChecks === 2) {
          throw new ForbiddenError("Refused after write.");
        }
      },
    });
    await insertDoc({ id: "doc-late", visibility: "public" });

    await expect(setPublic("doc-late", "commenter")).rejects.toThrow(
      "Refused after write.",
    );

    expect(await grants()).toEqual([]);
  });

  it("keeps one link row when two saves race", async () => {
    await insertDoc({ id: "doc-race", visibility: "public" });

    await Promise.all([
      setPublic("doc-race", "commenter"),
      setPublic("doc-race", "commenter"),
    ]);

    expect(await grants()).toEqual([
      { principalType: "link", role: "commenter" },
    ]);
  });

  it("leaves grants alone in a rollback once another request changed visibility", async () => {
    register({
      persistVisibilityChange: async ({ resourceId, update }) => {
        if (resourceId === "doc-second") {
          // Another request makes the first resource public in between.
          await db
            .update(docs)
            .set({ visibility: "public" })
            .where(eq(docs.id, "doc-first"));
          throw new Error("write failed");
        }
        await db.update(docs).set(update).where(eq(docs.id, resourceId));
      },
    });
    await insertDoc({ id: "doc-first", visibility: "org" });
    await insertDoc({ id: "doc-second", visibility: "org" });
    await db.insert(docShares).values({
      id: "share-org-first",
      resourceId: "doc-first",
      principalType: "org",
      principalId: orgId,
      role: "editor",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    } as never);

    await expect(batch(["doc-first", "doc-second"], "private")).rejects.toThrow(
      "write failed",
    );

    expect(await visibilities()).toEqual({
      "doc-first": "public",
      "doc-second": "org",
    });
    expect(await grants()).toEqual([]);
  });

  it("removes its role when another request made the resource private meanwhile", async () => {
    let grantChecks = 0;
    register({
      assertSharingChange: async ({ change }) => {
        if (change.kind === "grant" && ++grantChecks === 2) {
          await db
            .update(docs)
            .set({ visibility: "private" })
            .where(eq(docs.id, "doc-flip"));
        }
      },
    });
    await insertDoc({ id: "doc-flip", visibility: "org" });

    await expect(
      as({ userEmail: ownerEmail, orgId }, () =>
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-flip",
          visibility: "org",
          role: "editor",
        }),
      ),
    ).rejects.toThrow("changed visibility while its role was being saved");

    expect(await visibilities()).toEqual({ "doc-flip": "private" });
    expect(await grants()).toEqual([]);
  });

  it("folds an earlier organization grant into the one it writes", async () => {
    await insertDoc({ id: "doc-fold", visibility: "org" });
    await db.insert(docShares).values({
      id: "share-org-fold",
      resourceId: "doc-fold",
      principalType: "org",
      principalId: orgId,
      role: "editor",
      createdBy: ownerEmail,
      createdAt: new Date().toISOString(),
    } as never);

    await as({ userEmail: ownerEmail, orgId }, () =>
      setResourceVisibility.run({
        resourceType,
        resourceId: "doc-fold",
        visibility: "org",
        role: "commenter",
      }),
    );

    expect(await grants()).toEqual([
      { principalType: "org", role: "commenter" },
    ]);
  });

  it("keeps a newer request's link role when a rollback runs", async () => {
    register({
      persistVisibilityChange: async ({ resourceId, update }) => {
        if (resourceId === "doc-later") {
          // Another request saves the same role on the first resource.
          await db
            .update(docShares)
            .set({ createdAt: "2999-01-01T00:00:00.000Z" })
            .where(eq(docShares.resourceId, "doc-earlier"));
          throw new Error("write failed");
        }
        await db.update(docs).set(update).where(eq(docs.id, resourceId));
      },
    });
    await insertDoc({ id: "doc-earlier", visibility: "public" });
    await insertDoc({ id: "doc-later", visibility: "public" });

    await expect(
      as({ userEmail: ownerEmail, orgId }, () =>
        setResourceVisibility.run({
          resourceType,
          resourceIds: ["doc-earlier", "doc-later"],
          visibility: "public",
          role: "commenter",
        }),
      ),
    ).rejects.toThrow("write failed");

    expect(await grants()).toEqual([
      { principalType: "link", role: "commenter" },
    ]);
  });

  it("refuses a role change from a view of an older visibility", async () => {
    await insertDoc({ id: "doc-stale", visibility: "private" });

    await expect(
      as({ userEmail: ownerEmail, orgId }, () =>
        setResourceVisibility.run({
          resourceType,
          resourceId: "doc-stale",
          visibility: "public",
          expectedVisibility: "public",
          role: "commenter",
        }),
      ),
    ).rejects.toThrow("is now private, not public");

    expect(await visibilities()).toEqual({ "doc-stale": "private" });
    expect(await grants()).toEqual([]);
  });

  it("puts back every duplicate grant it folded when a later resource fails", async () => {
    register({
      persistVisibilityChange: persistUnless((resourceId) =>
        resourceId === "doc-fail" ? new Error("write failed") : undefined,
      ),
    });
    await insertDoc({ id: "doc-dupes", visibility: "org" });
    await insertDoc({ id: "doc-fail", visibility: "org" });
    for (const [id, role] of [
      ["share-org-1", "editor"],
      ["share-org-2", "viewer"],
    ]) {
      await db.insert(docShares).values({
        id,
        resourceId: "doc-dupes",
        principalType: "org",
        principalId: orgId,
        role,
        createdBy: ownerEmail,
        createdAt: new Date().toISOString(),
      } as never);
    }

    await expect(
      as({ userEmail: ownerEmail, orgId }, () =>
        setResourceVisibility.run({
          resourceType,
          resourceIds: ["doc-dupes", "doc-fail"],
          visibility: "org",
          role: "commenter",
        }),
      ),
    ).rejects.toThrow("write failed");

    expect(
      (await db.select().from(docShares)).map((row) => row.id).sort(),
    ).toEqual(["share-org-1", "share-org-2"]);
  });

  it("lists the link role apart from the people with access", async () => {
    await insertDoc({ id: "doc-listed" });
    await setPublic("doc-listed", "commenter");

    const listed = (await as({ userEmail: ownerEmail, orgId }, () =>
      listResourceShares.run({ resourceType, resourceId: "doc-listed" }),
    )) as Record<string, any>;

    expect(listed.linkRole).toBe("commenter");
    expect(listed.shares).toEqual([]);
  });
});

describe("set-resource-visibility public followers", () => {
  const followersOf: Record<string, string[]> = {};
  const parent = "doc-parent";
  // Like Content's walk: only the followers on the side that needs to change.
  const followersMatching = async (
    resource: { id: string },
    { isPublic }: { isPublic: boolean },
  ) => {
    const current = await visibilities();
    return (followersOf[resource.id] ?? []).filter(
      (id) => (current[id] === "public") === isPublic,
    );
  };

  beforeEach(() => {
    for (const key of Object.keys(followersOf)) delete followersOf[key];
    followersOf[parent] = ["doc-child", "doc-grandchild"];
    register({
      publicFollowers: followersMatching,
    });
  });

  async function insertFamily(
    visibilities: Partial<Record<string, Visibility>> = {},
  ) {
    for (const id of [parent, "doc-child", "doc-grandchild"]) {
      await insertDoc({ id, visibility: visibilities[id] ?? "private" });
    }
  }

  it("makes its followers public with it, and counts them apart", async () => {
    await insertFamily();

    const result = await setOne(parent, "public");

    expect(await visibilities()).toEqual({
      [parent]: "public",
      "doc-child": "public",
      "doc-grandchild": "public",
    });
    expect(result.followersChanged).toBe(2);
    expect(result.change.title).toBe(parent);
    expect(result).not.toHaveProperty("results");
    // One change was asked for, so one is tracked; every row's access cache
    // and notice still goes out.
    expect(calls.tracked).toHaveLength(1);
    expect(calls.invalidated).toEqual([
      `${resourceType}:${parent}`,
      `${resourceType}:doc-child`,
      `${resourceType}:doc-grandchild`,
    ]);
    expect(calls.notified.map((notice) => notice.resourceId)).toEqual([
      parent,
      "doc-child",
      "doc-grandchild",
    ]);
  });

  it("gives its followers the link role the call names", async () => {
    await insertFamily();

    await as({ userEmail: ownerEmail, orgId }, () =>
      setResourceVisibility.run({
        resourceType,
        resourceId: parent,
        visibility: "public",
        role: "commenter",
      }),
    );

    expect(
      (await db.select().from(docShares))
        .map((row) => `${row.resourceId}:${row.principalType}:${row.role}`)
        .sort(),
    ).toEqual([
      "doc-child:link:commenter",
      "doc-grandchild:link:commenter",
      `${parent}:link:commenter`,
    ]);
  });

  it("takes the followers still public with it when it leaves public", async () => {
    followersOf[parent] = ["doc-child", "doc-grandchild", "doc-org"];
    await insertFamily({
      [parent]: "public",
      "doc-child": "public",
      "doc-grandchild": "private",
    });
    await insertDoc({ id: "doc-org", visibility: "org" });

    const result = await setOne(parent, "private");

    expect(await visibilities()).toEqual({
      [parent]: "private",
      "doc-child": "private",
      "doc-grandchild": "private",
      "doc-org": "org",
    });
    expect(result.followersChanged).toBe(1);
  });

  it("walks again after its writes, for a follower created meanwhile", async () => {
    await insertFamily({ [parent]: "public", "doc-child": "public" });
    let walks = 0;
    register({
      publicFollowers: async (resource, options) => {
        const found = await followersMatching(resource, options);
        // A sub-page created just after the first walk, copying "public".
        if (++walks === 1) {
          await insertDoc({ id: "doc-late", visibility: "public" });
          followersOf[parent]?.push("doc-late");
        }
        return found;
      },
    });

    const result = await setOne(parent, "private");

    expect(await visibilities()).toEqual({
      [parent]: "private",
      "doc-child": "private",
      "doc-grandchild": "private",
      "doc-late": "private",
    });
    expect(result.followersChanged).toBe(2);
    expect(calls.notified.map((notice) => notice.resourceId)).toEqual([
      parent,
      "doc-child",
      "doc-late",
    ]);
  });

  it("writes its followers first when it leaves public, last when it goes public", async () => {
    await insertFamily();
    const order: string[] = [];
    register({
      publicFollowers: followersMatching,
      persistVisibilityChange: persistUnless((resourceId) => {
        order.push(resourceId);
        return undefined;
      }),
    });

    await setOne(parent, "public");
    expect(order).toEqual([parent, "doc-child", "doc-grandchild"]);
    order.length = 0;
    // A request that dies part-way leaves the page public, so the same
    // change can finish it.
    await setOne(parent, "private");
    expect(order).toEqual(["doc-child", "doc-grandchild", parent]);
  });

  it("undoes its followers when another change takes the page back meanwhile", async () => {
    await insertFamily();
    register({
      publicFollowers: followersMatching,
      // Another request makes the page private just after this one writes
      // its first follower, having walked while that follower was private.
      assertSharingChange: async ({ resource }) => {
        if (resource.id !== "doc-child") return;
        const current = await visibilities();
        if (current["doc-child"] === "public") {
          await db
            .update(docs)
            .set({ visibility: "private" })
            .where(eq(docs.id, parent));
        }
      },
    });

    await expect(setOne(parent, "public")).rejects.toThrow(
      "changed visibility while its sub-pages were being saved",
    );
    expect(await visibilities()).toEqual({
      [parent]: "private",
      "doc-child": "private",
      "doc-grandchild": "private",
    });
  });

  it("undoes the whole batch when a follower found by the second walk is refused", async () => {
    followersOf["doc-a"] = [];
    let added = false;
    register({
      publicFollowers: async (resource, options) => {
        const found = await followersMatching(resource, options);
        if (resource.id === "doc-a" && !added) {
          added = true;
          await insertDoc({ id: "doc-late", visibility: "public" });
          followersOf["doc-a"]?.push("doc-late");
        }
        return found;
      },
      assertSharingChange: ({ resource }) => {
        if (resource.id === "doc-late") {
          throw new ForbiddenError("held for review");
        }
      },
    });
    await insertDoc({ id: "doc-a", visibility: "public" });
    await insertDoc({ id: "doc-b", visibility: "public" });

    const refused = batch(["doc-a", "doc-b"], "private");

    // The refusal is the follower's, not pinned on the last page written.
    await expect(refused).rejects.toThrow("held for review");
    await expect(refused).rejects.not.toThrow("doc-b");
    expect(await visibilities()).toEqual({
      "doc-a": "public",
      "doc-b": "public",
      "doc-late": "public",
    });
  });

  it("follows it to the organization when it goes from public to org", async () => {
    await insertFamily({ [parent]: "public", "doc-child": "public" });

    await setOne(parent, "org");

    expect(await visibilities()).toEqual({
      [parent]: "org",
      "doc-child": "org",
      "doc-grandchild": "private",
    });
  });

  it("leaves its followers alone when its visibility doesn't cross public", async () => {
    await insertFamily({ [parent]: "public" });

    const samePublic = await setOne(parent, "public");
    expect(samePublic).not.toHaveProperty("followersChanged");
    await setOne(parent, "private");
    await setOne(parent, "org");

    expect(await visibilities()).toEqual({
      [parent]: "org",
      "doc-child": "private",
      "doc-grandchild": "private",
    });
  });

  it("leaves a follower the caller can't manage as it is", async () => {
    await insertFamily();
    await shareWith(parent, adminEmail, "admin");
    await shareWith("doc-child", adminEmail, "admin");
    await shareWith("doc-grandchild", adminEmail, "editor");

    const result = await setOne(parent, "public", {
      userEmail: adminEmail,
      orgId,
    });

    expect(await visibilities()).toEqual({
      [parent]: "public",
      "doc-child": "public",
      "doc-grandchild": "private",
    });
    expect(result.followersChanged).toBe(1);
  });

  it("doesn't hold followers to the visibility the caller expected", async () => {
    await insertFamily({ "doc-child": "org" });

    await as({ userEmail: ownerEmail, orgId }, () =>
      setResourceVisibility.run({
        resourceType,
        resourceId: parent,
        visibility: "public",
        expectedVisibility: "private",
      }),
    );

    expect((await visibilities())["doc-child"]).toBe("public");
  });

  it("changes a follower the call also names once, as asked", async () => {
    await insertFamily();

    const result = await batch([parent, "doc-child"], "public");

    expect(await visibilities()).toEqual({
      [parent]: "public",
      "doc-child": "public",
      "doc-grandchild": "public",
    });
    expect(result.changedCount).toBe(2);
    expect(result.followersChanged).toBe(1);
    expect(calls.notified.map((notice) => notice.resourceId)).toEqual([
      parent,
      "doc-child",
      "doc-grandchild",
    ]);
  });

  it("puts it and every follower back when a follower can't change", async () => {
    register({
      publicFollowers: followersMatching,
      persistVisibilityChange: persistUnless((resourceId) =>
        resourceId === "doc-grandchild" ? new Error("write failed") : undefined,
      ),
    });
    await insertFamily();

    await expect(setOne(parent, "public")).rejects.toThrow("write failed");

    expect(await visibilities()).toEqual({
      [parent]: "private",
      "doc-child": "private",
      "doc-grandchild": "private",
    });
    expect(calls.tracked).toEqual([]);
  });

  it("refuses a change that would carry too many followers", async () => {
    followersOf[parent] = Array.from(
      { length: MAX_PUBLIC_FOLLOWERS + 1 },
      (_, index) => `doc-many-${index}`,
    );
    await insertDoc({ id: parent });

    await expect(setOne(parent, "public")).rejects.toThrow(
      `more than ${MAX_PUBLIC_FOLLOWERS} sub-pages`,
    );
    expect(await visibilities()).toEqual({ [parent]: "private" });
  });

  it("holds a whole batch to the same limit", async () => {
    const half = Math.ceil((MAX_PUBLIC_FOLLOWERS + 1) / 2);
    for (const id of ["doc-a", "doc-b"]) {
      followersOf[id] = Array.from({ length: half }, (_, i) => `${id}-${i}`);
      await insertDoc({ id });
    }

    await expect(batch(["doc-a", "doc-b"], "public")).rejects.toThrow(
      `more than ${MAX_PUBLIC_FOLLOWERS} sub-pages`,
    );
    expect(await visibilities()).toEqual({
      "doc-a": "private",
      "doc-b": "private",
    });
  });

  it("says when there are more public followers than it counts", async () => {
    register({
      publicFollowers: async (_resource, { isPublic }) =>
        isPublic
          ? Array.from(
              { length: MAX_PUBLIC_FOLLOWERS + 1 },
              (_, index) => `doc-many-${index}`,
            )
          : [],
    });
    await insertDoc({ id: parent, visibility: "public" });

    const listed = (await as({ userEmail: ownerEmail, orgId }, () =>
      listResourceShares.run({ resourceType, resourceId: parent }),
    )) as Record<string, unknown>;

    expect(listed.publicFollowers).toBe(MAX_PUBLIC_FOLLOWERS);
    expect(listed.publicFollowersMore).toBe(true);
  });

  it("counts its public followers for the people who manage it", async () => {
    await insertFamily({ [parent]: "public", "doc-child": "public" });
    await shareWith(parent, adminEmail, "admin");
    await shareWith(parent, outsiderEmail, "editor");

    const list = (userEmail: string) =>
      as({ userEmail, orgId }, () =>
        listResourceShares.run({ resourceType, resourceId: parent }),
      ) as Promise<Record<string, any>>;

    expect((await list(ownerEmail)).publicFollowers).toBe(1);
    expect((await list(adminEmail)).publicFollowers).toBe(1);
    expect(await list(outsiderEmail)).not.toHaveProperty("publicFollowers");

    await setOne(parent, "private");
    expect(await list(ownerEmail)).not.toHaveProperty("publicFollowers");
  });
});
