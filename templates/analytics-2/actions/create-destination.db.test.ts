import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import createCollection from "./create-collection.js";
import createThread from "./create-thread.js";

const round = mkdtempSync(join(tmpdir(), "create-destination-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "navigation-owner@example.test";
const orgA = `qa-navigation-${randomUUID()}`;
const appId = "analytics-2";
const actionContext = () => ({
  caller: "frontend" as const,
  userEmail: owner,
  orgId: orgA,
  appId,
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_navigation_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgA,
    name: "QA workspace",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId: orgA,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
});
afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  rmSync(round, { recursive: true, force: true });
});

describe("create destination navigation", () => {
  it("opens agent-created threads and collections only in the requesting tab", async () => {
    const actor = {
      userEmail: owner,
      orgId: orgA,
      authUserId: owner,
      isSyntheticTraffic: true,
    };
    const toolTab = `qa-tab-${randomUUID()}`;
    await runWithRequestContext(
      { ...actor, run: { browserTabId: toolTab } },
      async () => {
        const kept = await createThread.run(
          {},
          { ...actionContext(), caller: "tool" },
        );
        expect(kept.navigation).toEqual({ status: "kept" });
        expect(await readAppStateForCurrentTab("navigate")).toBeNull();
        const thread = await createThread.run(
          { intent: "open" },
          { ...actionContext(), caller: "tool" },
        );
        expect(thread.navigation).toEqual({ status: "requested" });
        expect(await readAppStateForCurrentTab("navigate")).toMatchObject({
          path: thread.href,
        });
        const collection = await createCollection.run(
          { name: "QA agent collection", intent: "open" },
          { ...actionContext(), caller: "tool" },
        );
        expect(collection.id).toBe(collection.collection.id);
        expect(collection.href).toBe(
          `/collection/${encodeURIComponent(collection.id)}`,
        );
        expect(collection.navigation).toEqual({ status: "requested" });
        expect(await readAppStateForCurrentTab("navigate")).toMatchObject({
          path: `/collection/${encodeURIComponent(collection.collection.id)}`,
        });
      },
    );
    await runWithRequestContext(
      { ...actor, run: { browserTabId: `qa-browser-${randomUUID()}` } },
      async () => {
        const thread = await createThread.run({}, actionContext());
        const collection = await createCollection.run(
          { name: "QA browser collection" },
          actionContext(),
        );
        expect(thread.navigation).toBeUndefined();
        expect(collection.navigation).toBeUndefined();
        expect(await readAppStateForCurrentTab("navigate")).toBeNull();
      },
    );
    await runWithRequestContext(
      { ...actor, run: { browserTabId: `qa-other-${randomUUID()}` } },
      async () => {
        expect(await readAppStateForCurrentTab("navigate")).toBeNull();
      },
    );
  });
});
