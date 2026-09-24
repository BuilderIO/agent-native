import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONTENT_LAST_LOCATION_STATE_KEY,
  CONTENT_WELCOME_PAGE_STATE_KEY,
  contentSpaceLastLocationStateKey,
} from "../shared/content-landing.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-landing-${process.pid}-${Date.now()}.pglite`,
);
const WELCOME_TITLE = "Welcome to Agent-Native Content";

function legacyWelcomeDocumentId(userEmail: string, generation = 0) {
  const digest = createHash("sha256")
    .update(
      generation === 0
        ? userEmail.trim().toLowerCase()
        : `${userEmail.trim().toLowerCase()}:${generation}`,
    )
    .digest("hex");
  return `content_welcome_${digest.slice(0, 32)}`;
}

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let provisionContentSpaces: typeof import("./_content-spaces.js").provisionContentSpaces;
let createContentSpaceAction: typeof import("./create-content-space.js").default;
let createDocumentAction: typeof import("./create-document.js").default;
let resolveContentLandingAction: typeof import("./resolve-content-landing.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  ({ provisionContentSpaces } = await import("./_content-spaces.js"));
  createContentSpaceAction = (await import("./create-content-space.js"))
    .default;
  createDocumentAction = (await import("./create-document.js")).default;
  resolveContentLandingAction = (await import("./resolve-content-landing.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function createPersonalDocument(userEmail: string, id: string) {
  const provisioned = await runWithRequestContext({ userEmail }, () =>
    provisionContentSpaces(getDb(), userEmail),
  );
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: userEmail,
    orgId: null,
    spaceId: provisioned.personalSpaceId,
    parentId: null,
    title: "Saved page",
    content: "Saved content",
    position: 1,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
}

describe("resolve-content-landing", () => {
  it("creates and reuses a real welcome page in a user workspace", async () => {
    const userEmail = "workspace-welcome@example.com";
    const result = await runWithRequestContext({ userEmail }, async () => {
      const workspace = await createContentSpaceAction.run({
        name: "Workspace welcome",
        requestId: "workspace-welcome",
      });
      const concurrent = await Promise.all([
        resolveContentLandingAction.run({ spaceId: workspace.spaceId }),
        resolveContentLandingAction.run({ spaceId: workspace.spaceId }),
        resolveContentLandingAction.run({ spaceId: workspace.spaceId }),
      ]);
      const second = await resolveContentLandingAction.run({
        spaceId: workspace.spaceId,
      });
      return { workspace, concurrent, second };
    });

    expect(result.concurrent.map(({ resolution }) => resolution)).toContain(
      "welcome-created",
    );
    expect(
      new Set(result.concurrent.map(({ target }) => target?.documentId)).size,
    ).toBe(1);
    const [first] = result.concurrent;
    expect(first.target).toEqual({ documentId: expect.any(String) });
    expect(result.second).toEqual({
      resolution: "welcome-reused",
      target: first.target,
    });
    const welcomeDocumentId = first.target?.documentId;
    const [welcome] = await getDb()
      .select({
        spaceId: schema.documents.spaceId,
        visibility: schema.documents.visibility,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, welcomeDocumentId!));
    const [membership] = await getDb()
      .select({ documentId: schema.contentDatabaseItems.documentId })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(
            schema.contentDatabaseItems.databaseId,
            result.workspace.filesDatabaseId,
          ),
          eq(schema.contentDatabaseItems.documentId, welcomeDocumentId!),
        ),
      );
    expect(welcome).toMatchObject({
      spaceId: result.workspace.spaceId,
      visibility: "private",
    });
    expect(membership).toEqual({ documentId: welcomeDocumentId });
  });

  it("reuses an organization workspace welcome for another member", async () => {
    const ownerEmail = "workspace-welcome-owner@example.com";
    const memberEmail = "workspace-welcome-member@example.com";
    const orgId = "workspace-welcome-org";
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: [orgId, "Workspace Welcome Org", ownerEmail, Date.now()],
    });
    for (const [id, email, role] of [
      ["workspace-welcome-owner", ownerEmail, "owner"],
      ["workspace-welcome-member", memberEmail, "member"],
    ]) {
      await getDbExec().execute({
        sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
        args: [id, orgId, email, role, Date.now()],
      });
    }

    const provisioned = await runWithRequestContext(
      { userEmail: ownerEmail },
      () => provisionContentSpaces(getDb(), ownerEmail),
    );
    const spaceId = provisioned.spaceIds.find(
      (candidate) => candidate !== provisioned.personalSpaceId,
    )!;
    const created = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      resolveContentLandingAction.run({ spaceId }),
    );
    const reused = await runWithRequestContext({ userEmail: memberEmail }, () =>
      resolveContentLandingAction.run({ spaceId }),
    );

    expect(created.resolution).toBe("welcome-created");
    expect(reused).toEqual({
      resolution: "welcome-reused",
      target: created.target,
    });
    const [welcome] = await getDb()
      .select({
        orgId: schema.documents.orgId,
        visibility: schema.documents.visibility,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, created.target!.documentId));
    expect(welcome).toEqual({ orgId, visibility: "org" });
  });

  it("restores each workspace's exact saved page independently", async () => {
    const userEmail = "workspace-restore@example.com";
    const result = await runWithRequestContext({ userEmail }, async () => {
      const firstWorkspace = await createContentSpaceAction.run({
        name: "First workspace",
        requestId: "workspace-restore-first",
      });
      const secondWorkspace = await createContentSpaceAction.run({
        name: "Second workspace",
        requestId: "workspace-restore-second",
      });
      const firstPage = await createDocumentAction.run({
        title: "First saved page",
        spaceId: firstWorkspace.spaceId,
      });
      const secondPage = await createDocumentAction.run({
        title: "Second saved page",
        spaceId: secondWorkspace.spaceId,
      });
      await writeAppState(
        contentSpaceLastLocationStateKey(firstWorkspace.spaceId),
        { documentId: firstPage.id },
      );
      await writeAppState(
        contentSpaceLastLocationStateKey(secondWorkspace.spaceId),
        { documentId: secondPage.id },
      );
      const landings = await Promise.all([
        resolveContentLandingAction.run({ spaceId: firstWorkspace.spaceId }),
        resolveContentLandingAction.run({ spaceId: secondWorkspace.spaceId }),
      ]);
      return { firstPage, secondPage, landings };
    });

    expect(result.landings).toEqual([
      {
        target: { documentId: result.firstPage.id },
        resolution: "restored",
      },
      {
        target: { documentId: result.secondPage.id },
        resolution: "restored",
      },
    ]);
  });

  it("falls back when a saved database identity is no longer available", async () => {
    const userEmail = "workspace-missing-database@example.com";
    const result = await runWithRequestContext({ userEmail }, async () => {
      const workspace = await createContentSpaceAction.run({
        name: "Missing database workspace",
        requestId: "workspace-missing-database",
      });
      const page = await createDocumentAction.run({
        title: "Page with stale database destination",
        spaceId: workspace.spaceId,
      });
      await writeAppState(contentSpaceLastLocationStateKey(workspace.spaceId), {
        documentId: page.id,
        databaseId: "missing-database",
      });
      return {
        page,
        landing: await resolveContentLandingAction.run({
          spaceId: workspace.spaceId,
        }),
      };
    });

    expect(result.landing).toMatchObject({
      resolution: "fallback",
      fallbackReason: "saved-document-unavailable",
      target: { documentId: expect.any(String) },
    });
    expect(result.landing.target?.documentId).not.toBe(result.page.id);
  });

  it("restores only a currently authorized saved document", async () => {
    const userEmail = "landing-restored@example.com";
    const documentId = "landing-restored-document";
    await createPersonalDocument(userEmail, documentId);

    const result = await runWithRequestContext({ userEmail }, async () => {
      await writeAppState(CONTENT_LAST_LOCATION_STATE_KEY, { documentId });
      return resolveContentLandingAction.run({});
    });

    expect(result).toEqual({ documentId, resolution: "restored" });
  });

  it("falls back without exposing an inaccessible saved document", async () => {
    const ownerEmail = "landing-owner@example.com";
    const outsiderEmail = "landing-outsider@example.com";
    const inaccessibleDocumentId = "landing-owner-private-document";
    await createPersonalDocument(ownerEmail, inaccessibleDocumentId);

    const result = await runWithRequestContext(
      { userEmail: outsiderEmail },
      async () => {
        await writeAppState(CONTENT_LAST_LOCATION_STATE_KEY, {
          documentId: inaccessibleDocumentId,
        });
        return resolveContentLandingAction.run({});
      },
    );

    expect(result).toMatchObject({
      resolution: "fallback",
      fallbackReason: "saved-document-unavailable",
    });
    expect(result.documentId).not.toBe(inaccessibleDocumentId);
    expect(Object.keys(result)).toEqual([
      "documentId",
      "resolution",
      "fallbackReason",
    ]);
  });

  it("falls back from a deleted saved document", async () => {
    const userEmail = "landing-deleted@example.com";
    const deletedDocumentId = "landing-deleted-document";
    await createPersonalDocument(userEmail, deletedDocumentId);
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, deletedDocumentId));

    const result = await runWithRequestContext({ userEmail }, async () => {
      await writeAppState(CONTENT_LAST_LOCATION_STATE_KEY, {
        documentId: deletedDocumentId,
      });
      return resolveContentLandingAction.run({});
    });

    expect(result).toMatchObject({
      resolution: "fallback",
      fallbackReason: "saved-document-unavailable",
    });
    expect(result.documentId).not.toBe(deletedDocumentId);
  });

  it("does not select an arbitrary existing document for a fresh landing", async () => {
    const userEmail = "landing-existing-page@example.com";
    const existingDocumentId = "landing-existing-page";
    await createPersonalDocument(userEmail, existingDocumentId);

    const result = await runWithRequestContext({ userEmail }, () =>
      resolveContentLandingAction.run({}),
    );

    expect(result).toMatchObject({ resolution: "welcome-created" });
    expect(result.documentId).not.toBe(existingDocumentId);
  });

  it("reuses the welcome page when the request email is not canonical", async () => {
    const userEmail = "  Landing.MixedCase@Example.com ";

    const first = await runWithRequestContext({ userEmail }, () =>
      resolveContentLandingAction.run({}),
    );
    const second = await runWithRequestContext({ userEmail }, () =>
      resolveContentLandingAction.run({}),
    );

    expect(first.resolution).toBe("welcome-created");
    expect(second).toEqual({
      documentId: first.documentId,
      resolution: "welcome-reused",
    });
  });

  it("keeps a renamed welcome page as the user's landing page", async () => {
    const userEmail = "landing-renamed@example.com";
    const first = await runWithRequestContext({ userEmail }, () =>
      resolveContentLandingAction.run({}),
    );
    await getDb()
      .update(schema.documents)
      .set({ title: "My renamed start page" })
      .where(eq(schema.documents.id, first.documentId));

    const second = await runWithRequestContext({ userEmail }, () =>
      resolveContentLandingAction.run({}),
    );

    expect(second).toEqual({
      documentId: first.documentId,
      resolution: "welcome-reused",
    });
  });

  it("replaces a trashed welcome page without restoring it", async () => {
    const userEmail = "landing-trashed-welcome@example.com";
    const first = await runWithRequestContext({ userEmail }, () =>
      resolveContentLandingAction.run({}),
    );
    const trashedAt = new Date().toISOString();
    await getDb()
      .update(schema.documents)
      .set({ trashedAt })
      .where(eq(schema.documents.id, first.documentId));

    const [second, concurrent] = await Promise.all([
      runWithRequestContext({ userEmail }, () =>
        resolveContentLandingAction.run({}),
      ),
      runWithRequestContext({ userEmail }, () =>
        resolveContentLandingAction.run({}),
      ),
    ]);

    expect(second.documentId).not.toBe(first.documentId);
    expect(concurrent.documentId).toBe(second.documentId);
    const [original] = await getDb()
      .select({ trashedAt: schema.documents.trashedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, first.documentId));
    expect(original.trashedAt).toBe(trashedAt);
  });

  it("leaves the predictable ID sequence after one legacy collision", async () => {
    const userEmail = "landing-collision-target@example.com";
    const collidingDocumentId = legacyWelcomeDocumentId(userEmail);
    const nextPredictableDocumentId = legacyWelcomeDocumentId(userEmail, 1);
    await createPersonalDocument(
      "landing-collision-owner@example.com",
      collidingDocumentId,
    );
    await createPersonalDocument(
      "landing-next-collision-owner@example.com",
      nextPredictableDocumentId,
    );
    await runWithRequestContext({ userEmail }, () =>
      writeAppState(CONTENT_WELCOME_PAGE_STATE_KEY, {
        generation: 0,
        futureField: "preserved for CAS",
      }),
    );

    const result = await runWithRequestContext({ userEmail }, () =>
      resolveContentLandingAction.run({}),
    );

    expect(result).toMatchObject({ resolution: "welcome-created" });
    expect(result.documentId).not.toBe(collidingDocumentId);
    expect(result.documentId).not.toBe(nextPredictableDocumentId);
    const welcomeState = await runWithRequestContext(
      { userEmail },
      async () => {
        const [{ value }] = await (
          await import("@agent-native/core/application-state")
        ).listAppState(CONTENT_WELCOME_PAGE_STATE_KEY);
        return value;
      },
    );
    expect(welcomeState).toMatchObject({
      generation: 1,
      documentId: result.documentId,
      futureField: "preserved for CAS",
    });
  });

  it("fails loudly for a stored null welcome state", async () => {
    const userEmail = "landing-null-state@example.com";
    await runWithRequestContext({ userEmail }, () =>
      writeAppState(CONTENT_WELCOME_PAGE_STATE_KEY, null as never),
    );

    await expect(
      runWithRequestContext({ userEmail }, () =>
        resolveContentLandingAction.run({}),
      ),
    ).rejects.toThrow("Content welcome page state must be an object");
  });

  it("converges concurrent root invocations on one private welcome page", async () => {
    const userEmail = "landing-concurrent@example.com";
    const resolve = () =>
      runWithRequestContext({ userEmail }, () =>
        resolveContentLandingAction.run({}),
      );

    const results = await Promise.all([resolve(), resolve(), resolve()]);
    expect(new Set(results.map((result) => result.documentId)).size).toBe(1);
    expect(results.map((result) => result.resolution)).toContain(
      "welcome-created",
    );

    const welcomes = await getDb()
      .select({
        visibility: schema.documents.visibility,
        parentId: schema.documents.parentId,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.ownerEmail, userEmail),
          eq(schema.documents.title, WELCOME_TITLE),
        ),
      );
    expect(welcomes).toHaveLength(1);
    expect(welcomes[0]).toMatchObject({
      visibility: "private",
      parentId: null,
    });
  });
});
