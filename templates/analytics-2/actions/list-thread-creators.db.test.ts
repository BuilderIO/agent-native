import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, getDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import listThreadCreators from "./list-thread-creators.js";

const round = mkdtempSync(join(tmpdir(), "list-thread-creators-"));
const previousDatabase = process.env.DATABASE_URL;
const orgId = `qa-creators-${randomUUID()}`;
const otherOrgId = `qa-creators-other-${randomUUID()}`;
const viewer = "viewer@example.test";

const call = (ownerEmails: string[]) =>
  runWithRequestContext(
    {
      userEmail: viewer,
      orgId,
      authUserId: viewer,
      userName: "Viewer",
      isSyntheticTraffic: true,
    },
    () =>
      listThreadCreators.run(
        { ownerEmails },
        { caller: "frontend", userEmail: viewer, orgId, appId: "analytics-2" },
      ),
  );

async function member(org: string, email: string, name: string | null) {
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId: org,
    email,
    role: "member",
    joinedAt: Date.now(),
  });
  await getDbExec().execute({
    sql: `INSERT INTO "user" (id, name, email, image) VALUES (?, ?, ?, ?)`,
    args: [randomUUID(), name, email, "https://img.example.test/a.png"],
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_list_thread_creators_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDbExec().execute({
    sql: `CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL, image TEXT)`,
    args: [],
  });
  for (const id of [orgId, otherOrgId])
    await getDb().insert(organizations).values({
      id,
      name: id,
      createdBy: viewer,
      createdAt: Date.now(),
    });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: viewer,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: viewer,
    appId: "analytics-2",
    role: "owner",
    updatedBy: viewer,
    updatedAt: Date.now(),
  });
  await member(orgId, "ada@example.test", "Ada Lovelace");
  await member(otherOrgId, "outsider@example.test", "Outside Person");
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (owned.startsWith(temporary + "/list-thread-creators-"))
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("list-thread-creators against a real database", () => {
  it("returns a member of this workspace and omits a member of another one", async () => {
    const result = await call([
      "ADA@example.test",
      "outsider@example.test",
      "nobody@example.test",
    ]);
    expect(result.creators).toEqual([
      {
        email: "ada@example.test",
        name: "Ada Lovelace",
        imageUrl: "https://img.example.test/a.png",
      },
    ]);
  });

  it("accepts a full batch of 100 emails", async () => {
    const emails = Array.from({ length: 99 }, (_, i) => `u${i}@example.test`);
    const result = await call([...emails, "ada@example.test"]);
    expect(result.creators.map((creator) => creator.email)).toEqual([
      "ada@example.test",
    ]);
  });
});
