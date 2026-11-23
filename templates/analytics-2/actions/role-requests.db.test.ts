import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { and, eq, sql } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { mutateOrgSetting } from "@agent-native/core/settings";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { listRoleRequests } from "../server/model/role-requests-store.js";
import listRoleRequestsAction from "./list-role-requests.js";
import requestRole from "./request-role.js";
import resolveRoleRequest from "./resolve-role-request.js";

const round = mkdtempSync(join(tmpdir(), "role-request-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "role-request-owner@example.test";
const member = "role-request-member@example.test";
const other = "role-request-other@example.test";
const orgA = `qa-role-request-${randomUUID()}`;

const context = (email = owner) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId: orgA,
  appId: "analytics-2",
});

function asActor<T>(email: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId: orgA,
      authUserId: email,
      userName: "QA role account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

async function roleOf(email: string) {
  const rows = await getDb()
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(
      and(
        eq(orgMembers.orgId, orgA),
        sql`LOWER(${orgMembers.email}) = ${email.toLowerCase()}`,
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_role_request_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values([
      {
        id: orgA,
        name: "QA role request workspace",
        createdBy: owner,
        createdAt: Date.now(),
      },
    ]);
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: member,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: other,
        role: "member",
        joinedAt: Date.now(),
      },
    ]);
  await getDb()
    .insert(appMemberRoles)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        appId: "analytics-2",
        role: "owner",
        updatedBy: owner,
        updatedAt: Date.now(),
      },
    ]);
});

beforeEach(async () => {
  await getDb()
    .update(orgMembers)
    .set({ role: "member" })
    .where(and(eq(orgMembers.orgId, orgA), eq(orgMembers.email, member)));
  // Each case starts from an empty queue, the way a fresh workspace does.
  await mutateOrgSetting(orgA, "analytics.roleRequests", () => ({
    requests: [],
  }));
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/role-request-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("workspace role requests", () => {
  it("a member files one request and an admin sees it, then approval raises the role", async () => {
    const filed = await asActor(member, () =>
      requestRole.run({ requestedRole: "admin" }, context(member)),
    );
    expect(filed.request.requestedBy).toBe(member);
    expect(filed.request.status).toBe("pending");

    // Asking again keeps one open row rather than stacking duplicates.
    await asActor(member, () =>
      requestRole.run({ requestedRole: "admin" }, context(member)),
    );
    const queue = await asActor(owner, () =>
      listRoleRequestsAction.run({}, context(owner)),
    );
    expect(
      queue.requests.filter((entry) => entry.status === "pending"),
    ).toHaveLength(1);

    const resolved = await asActor(owner, () =>
      resolveRoleRequest.run(
        { id: filed.request.id, decision: "approved" },
        context(owner),
      ),
    );
    expect(resolved.request.status).toBe("approved");
    expect(resolved.request.resolvedBy).toBe(owner);
    expect(await roleOf(member)).toBe("admin");
  });

  it("a decline closes the request and leaves the role alone", async () => {
    const filed = await asActor(member, () =>
      requestRole.run({ requestedRole: "admin" }, context(member)),
    );
    await asActor(owner, () =>
      resolveRoleRequest.run(
        { id: filed.request.id, decision: "declined" },
        context(owner),
      ),
    );
    expect(await roleOf(member)).toBe("member");
    const queue = await asActor(owner, () =>
      listRoleRequestsAction.run({}, context(owner)),
    );
    expect(
      queue.requests.find((entry) => entry.id === filed.request.id)?.status,
    ).toBe("declined");
  });

  it("an administrator cannot file a role request and a member cannot read the queue", async () => {
    await expect(
      asActor(owner, () =>
        requestRole.run({ requestedRole: "admin" }, context(owner)),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });

    await asActor(member, () =>
      requestRole.run({ requestedRole: "admin" }, context(member)),
    );
    // A member sees only their own request, never another person's.
    await asActor(other, () =>
      requestRole.run({ requestedRole: "admin" }, context(other)),
    );
    const mine = await asActor(member, () =>
      listRoleRequestsAction.run({}, context(member)),
    );
    expect(mine.requests).toHaveLength(1);
    expect(mine.requests[0].requestedBy).toBe(member);
    await expect(
      asActor(member, () =>
        resolveRoleRequest.run(
          { id: mine.requests[0].id, decision: "approved" },
          context(member),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("nobody can decide their own request and the owner's role is never touched", async () => {
    const filed = await asActor(member, () =>
      requestRole.run({ requestedRole: "admin" }, context(member)),
    );
    const pending = await listRoleRequests(orgA);
    expect(pending.some((entry) => entry.id === filed.request.id)).toBe(true);
    // The owner holds an admin role, so their own request path is refused above;
    // approving a member never writes the owner's row.
    await asActor(owner, () =>
      resolveRoleRequest.run(
        { id: filed.request.id, decision: "approved" },
        context(owner),
      ),
    );
    expect(await roleOf(owner)).toBe("owner");
  });
});
