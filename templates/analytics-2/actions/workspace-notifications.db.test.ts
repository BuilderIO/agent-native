import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  insertInboxNotification,
  listNotifications,
} from "@agent-native/core/notifications";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import list from "./list-workspace-notifications.js";
import mark from "./mark-workspace-notifications-read.js";

const directory = mkdtempSync(join(tmpdir(), "analytics-notifications-"));
const previous = process.env.DATABASE_URL;
const owner = "notifications@example.test";
const orgId = `notifications-${randomUUID()}`;
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};
const asOwner = <T>(fn: () => T) =>
  runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "QA",
      isSyntheticTraffic: true,
    },
    fn,
  );
beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(directory, "db")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "test_notification_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values({ id: orgId, name: "QA", createdBy: owner, createdAt: Date.now() });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: owner,
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
});
afterAll(async () => {
  await closeDbExec();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
  rmSync(directory, { recursive: true, force: true });
});
it("report 1794899542.541439 persists individual and mark-all reads in the user's inbox", async () => {
  const one = await insertInboxNotification({
    owner,
    title: "First",
    severity: "info",
  });
  await insertInboxNotification({ owner, title: "Second", severity: "info" });
  await insertInboxNotification({
    owner: "other@example.test",
    title: "Other",
    severity: "info",
  });
  expect((await asOwner(() => list.run({}, context))).unreadCount).toBe(2);
  await asOwner(() => mark.run({ id: one.id }, context));
  const afterOne = await asOwner(() => list.run({}, context));
  expect(afterOne.unreadCount).toBe(1);
  expect(afterOne.items.find((item) => item.id === one.id)?.read).toBe(true);
  expect(afterOne.items.map((item) => item.title).sort()).toEqual([
    "First",
    "Second",
  ]);
  await asOwner(() => mark.run({}, context));
  expect((await asOwner(() => list.run({}, context))).unreadCount).toBe(0);
  expect((await listNotifications("other@example.test"))[0]?.readAt).toBeNull();
});
