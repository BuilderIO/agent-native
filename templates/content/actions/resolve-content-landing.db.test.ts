import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeAppState } from "@agent-native/core/application-state";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTENT_LAST_LOCATION_STATE_KEY } from "../shared/content-landing.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-landing-${process.pid}-${Date.now()}.sqlite`,
);
const WELCOME_TITLE = "Welcome to Agent-Native Content";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let provisionContentSpaces: typeof import("./_content-spaces.js").provisionContentSpaces;
let resolveContentLandingAction: typeof import("./resolve-content-landing.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  ({ provisionContentSpaces } = await import("./_content-spaces.js"));
  resolveContentLandingAction = (await import("./resolve-content-landing.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
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

    const [welcome] = await getDb()
      .select({
        count: sql<number>`count(*)`,
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
    expect(Number(welcome.count)).toBe(1);
    expect(welcome).toMatchObject({ visibility: "private", parentId: null });
  });
});
