import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getBuiltInDeckTemplate } from "../server/lib/deck-templates.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `deck-template-copy-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = {
  userEmail: "template-owner@example.test",
  orgId: "template-org",
};
const notifyClients = vi.hoisted(() => vi.fn());
vi.mock("../server/handlers/decks.js", () => ({ notifyClients }));

let dbModule: typeof import("../server/db/index.js");
let create: typeof import("./create-deck-from-template.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides.example.test";
  dbModule = await import("../server/db/index.js");
  create = (await import("./create-deck-from-template.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);
}, 120000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function row(id: string) {
  const { getDb, schema } = dbModule;
  return (
    await getDb()
      .select()
      .from(schema.decks)
      .where(
        and(
          eq(schema.decks.id, id),
          eq(schema.decks.ownerEmail, OWNER.userEmail),
          eq(schema.decks.orgId, OWNER.orgId),
        ),
      )
  )[0];
}

describe("template copies in isolated PGlite", () => {
  it("persists complete native slide content and scopes a no-write retry", async () => {
    const args = { templateId: "starter-company", newId: "template-db-copy" };
    const first = await runWithRequestContext(OWNER, () => create.run(args));
    const original = await row(first.id);
    expect(original).toMatchObject({
      ownerEmail: OWNER.userEmail,
      orgId: OWNER.orgId,
      designSystemId: null,
    });
    const stored = JSON.parse(original.data);
    expect(
      stored.slides.map((slide: { content: string }) => slide.content),
    ).toEqual(
      getBuiltInDeckTemplate(args.templateId)!.slides.map(
        (slide) => slide.content,
      ),
    );
    const again = await runWithRequestContext(OWNER, () => create.run(args));
    expect(again).toMatchObject({
      id: first.id,
      reused: true,
      slideCount: getBuiltInDeckTemplate(args.templateId)!.slides.length,
    });
    expect(await row(first.id)).toEqual(original);
    expect(notifyClients).toHaveBeenCalledExactlyOnceWith(first.id);

    for (const context of [
      { ...OWNER, userEmail: "other@example.test" },
      { ...OWNER, orgId: "other-org" },
    ]) {
      await expect(
        runWithRequestContext(context, () => create.run(args)),
      ).rejects.toMatchObject({
        errorCode: "deck_template_copy_conflict",
        statusCode: 409,
      });
      expect(await row(first.id)).toEqual(original);
    }
    await expect(
      runWithRequestContext(OWNER, () =>
        create.run({ ...args, templateId: "starter-pitch" }),
      ),
    ).rejects.toMatchObject({ errorCode: "deck_template_copy_conflict" });
    expect(await row(first.id)).toEqual(original);
  });

  it("does not persist signed-out or unknown-template requests", async () => {
    await expect(
      runWithRequestContext({}, () =>
        create.run({ templateId: "starter-pitch", newId: "signed-out-copy" }),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      runWithRequestContext(OWNER, () =>
        create.run({ templateId: "unknown", newId: "unknown-copy" }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await row("signed-out-copy")).toBeUndefined();
    expect(await row("unknown-copy")).toBeUndefined();
  });
});
