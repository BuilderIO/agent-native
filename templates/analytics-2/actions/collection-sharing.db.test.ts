import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import shareResource from "@agent-native/core/sharing/actions/share-resource";
import unshareResource from "@agent-native/core/sharing/actions/unshare-resource";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { readCollectionSharing } from "../server/model/collections-store.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import addProjectToCollection from "./add-project-to-collection.js";
import createCollection from "./create-collection.js";
import deleteCollection from "./delete-collection.js";
import listCollections from "./list-collections.js";
import listProjectCollections from "./list-project-collections.js";
import listProjects from "./list-projects.js";
import removeProjectFromCollection from "./remove-project-from-collection.js";
import updateCollection from "./update-collection.js";

const round = mkdtempSync(join(tmpdir(), "collection-sharing-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "share-owner@example.test";
const granted = "share-granted@example.test";
const bystander = "share-bystander@example.test";
const foreign = "share-foreign@example.test";
const viewerOnly = "share-viewer@example.test";
const orgId = `qa-share-${randomUUID()}`;
const foreignOrgId = `qa-share-foreign-${randomUUID()}`;
const context = (email: string, org: string) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId: org,
  appId: "analytics-2",
});

function as<T>(email: string, call: () => T, org = orgId) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId: org,
      authUserId: email,
      userName: "QA collection sharing",
      isSyntheticTraffic: true,
    },
    call,
  );
}
const create = (input: Parameters<typeof createCollection.run>[0]) =>
  as(owner, () => createCollection.run(input, context(owner, orgId)));
const listAs = (email: string, org = orgId) =>
  as(email, () => listCollections.run({}, context(email, org)), org).then(
    (result) => result.collections,
  );

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_collection_sharing_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  const db = getDb();
  await db.insert(organizations).values([
    { id: orgId, name: "QA share", createdBy: owner, createdAt: Date.now() },
    {
      id: foreignOrgId,
      name: "QA share foreign",
      createdBy: foreign,
      createdAt: Date.now(),
    },
  ]);
  const member = (email: string, org: string, role: string) => ({
    id: randomUUID(),
    orgId: org,
    email,
    role,
    joinedAt: Date.now(),
  });
  await db
    .insert(orgMembers)
    .values([
      member(owner, orgId, "owner"),
      member(granted, orgId, "member"),
      member(bystander, orgId, "member"),
      member(viewerOnly, orgId, "member"),
      member(foreign, foreignOrgId, "owner"),
    ]);
  await db.insert(appMemberRoles).values(
    (
      [
        { email: owner, orgId, role: "manager" },
        { email: granted, orgId, role: "editor" },
        { email: bystander, orgId, role: "editor" },
        { email: viewerOnly, orgId, role: "viewer" },
        { email: foreign, orgId: foreignOrgId, role: "manager" },
      ] as const
    ).map((actor) => ({
      id: randomUUID(),
      ...actor,
      appId: "analytics-2",
      updatedBy: owner,
      updatedAt: Date.now(),
    })),
  );
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (owned.startsWith(temporary + "/collection-sharing-"))
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("sharing a collection at creation", () => {
  it("defaults to private: only the creator reads it, with no grants stored", async () => {
    const made = await create({ name: "QA private default" });
    expect(made.sharing).toEqual({ workspaceRole: null, users: [] });
    const [mine] = (await listAs(owner)).filter((c) => c.id === made.id);
    expect(mine).toMatchObject({ isPrivate: true, sharedWithWorkspace: false });
    for (const email of [granted, bystander]) {
      expect((await listAs(email)).some((c) => c.id === made.id)).toBe(false);
    }
    expect(await getDb().select().from(schema.collectionShares)).toEqual([]);
  });

  it("shares with the workspace at the chosen role and readback matches", async () => {
    const made = await create({
      name: "QA workspace shared",
      sharing: { workspaceRole: "manager" },
    });
    expect(made.sharing).toEqual({ workspaceRole: "manager", users: [] });
    const seen = (await listAs(bystander)).find((c) => c.id === made.id);
    expect(seen).toMatchObject({
      name: "QA workspace shared",
      ownedByYou: false,
      sharedWithWorkspace: true,
      isPrivate: false,
    });
    const defaulted = await create({
      name: "QA workspace member role",
      sharing: { workspaceRole: "member" },
    });
    expect(defaulted.sharing.workspaceRole).toBe("member");
  });

  it("shares with selected members only; others and foreign workspaces cannot read", async () => {
    const made = await create({
      name: "QA selected members",
      sharing: { users: [{ email: granted.toUpperCase(), role: "member" }] },
    });
    expect(made.sharing).toEqual({
      workspaceRole: null,
      users: [{ email: granted, role: "member" }],
    });
    expect((await listAs(granted)).some((c) => c.id === made.id)).toBe(true);
    expect((await listAs(bystander)).some((c) => c.id === made.id)).toBe(false);
    expect(
      (await listAs(foreign, foreignOrgId)).some((c) => c.id === made.id),
    ).toBe(false);
  });

  it("a workspace-shared collection is invisible from another workspace", async () => {
    const made = await create({
      name: "QA not cross-workspace",
      sharing: { workspaceRole: "member" },
    });
    expect(
      (await listAs(foreign, foreignOrgId)).some((c) => c.id === made.id),
    ).toBe(false);
  });

  it("rejects a recipient outside the workspace and writes nothing", async () => {
    const before = await getDb().select().from(schema.collections);
    await expect(
      create({
        name: "QA outsider",
        sharing: {
          workspaceRole: "member",
          users: [{ email: foreign, role: "member" }],
        },
      }),
    ).rejects.toThrow(/not in this workspace/);
    expect(await getDb().select().from(schema.collections)).toHaveLength(
      before.length,
    );
    expect(
      (await getDb().select().from(schema.collectionShares)).some(
        (row) => row.principalId === foreign,
      ),
    ).toBe(false);
  });

  it("a Member cannot rename or delete; a non-grantee cannot delete", async () => {
    const made = await create({
      name: "QA recipients read only",
      sharing: { users: [{ email: granted, role: "member" }] },
    });
    await expect(
      as(granted, () =>
        updateCollection.run(
          { collectionId: made.id, name: "Hijacked" },
          context(granted, orgId),
        ),
      ),
    ).rejects.toThrow();
    await expect(
      as(bystander, () =>
        deleteCollection.run(
          { collectionId: made.id },
          context(bystander, orgId),
        ),
      ),
    ).rejects.toThrow();
    const stillThere = (await listAs(owner)).find((c) => c.id === made.id);
    expect(stillThere?.name).toBe("QA recipients read only");
  });

  it("revocation: deleting the collection removes its grants and the recipient's read", async () => {
    const made = await create({
      name: "QA revoked",
      sharing: {
        workspaceRole: "member",
        users: [{ email: granted, role: "member" }],
      },
    });
    expect((await listAs(granted)).some((c) => c.id === made.id)).toBe(true);
    await as(owner, () =>
      deleteCollection.run({ collectionId: made.id }, context(owner, orgId)),
    );
    expect((await listAs(granted)).some((c) => c.id === made.id)).toBe(false);
    expect(
      (await getDb().select().from(schema.collectionShares)).filter(
        (row) => row.resourceId === made.id,
      ),
    ).toEqual([]);
  });

  it("revocation through the framework unshare removes each grant's read", async () => {
    const made = await create({
      name: "QA unshare grants",
      sharing: {
        workspaceRole: "member",
        users: [{ email: granted, role: "member" }],
      },
    });
    const unshare = (principalType: "user" | "org", principalId: string) =>
      as(owner, () =>
        unshareResource.run(
          {
            resourceType: "analytics-collection",
            resourceId: made.id,
            principalType,
            principalId,
          },
          context(owner, orgId),
        ),
      );
    await unshare("org", orgId);
    expect((await listAs(bystander)).some((c) => c.id === made.id)).toBe(false);
    const afterOrg = (await listAs(owner)).find((c) => c.id === made.id);
    expect(afterOrg).toMatchObject({
      sharedWithWorkspace: false,
      isPrivate: true,
    });
    expect((await listAs(granted)).some((c) => c.id === made.id)).toBe(true);
    await unshare("user", granted);
    expect((await listAs(granted)).some((c) => c.id === made.id)).toBe(false);
  });

  it("a Manager can rename and file projects; a Member can do neither", async () => {
    const made = await create({
      name: "QA role effects",
      sharing: {
        users: [
          { email: granted, role: "manager" },
          { email: bystander, role: "member" },
        ],
      },
    });
    const renamed = await as(granted, () =>
      updateCollection.run(
        { collectionId: made.id, name: "QA renamed by manager" },
        context(granted, orgId),
      ),
    );
    expect(renamed.collection.name).toBe("QA renamed by manager");
    await expect(
      as(bystander, () =>
        updateCollection.run(
          { collectionId: made.id, name: "QA member rename" },
          context(bystander, orgId),
        ),
      ),
    ).rejects.toThrow(/permission/);
    const managerProject = await createProject({
      ownerEmail: granted,
      orgId,
      title: "QA manager project",
    });
    await as(granted, () =>
      addProjectToCollection.run(
        { projectId: managerProject.id, collectionId: made.id },
        context(granted, orgId),
      ),
    );
    const memberProject = await createProject({
      ownerEmail: bystander,
      orgId,
      title: "QA member project",
    });
    await expect(
      as(bystander, () =>
        addProjectToCollection.run(
          { projectId: memberProject.id, collectionId: made.id },
          context(bystander, orgId),
        ),
      ),
    ).rejects.toThrow(/permission/);
    await expect(
      as(granted, () =>
        deleteCollection.run(
          { collectionId: made.id },
          context(granted, orgId),
        ),
      ),
    ).rejects.toThrow();
  });

  it("reads back framework roles instead of dropping them", async () => {
    const made = await create({ name: "QA viewer readback" });
    await getDb()
      .insert(schema.collectionShares)
      .values({
        id: `cshare_${randomUUID()}`,
        resourceId: made.id,
        principalType: "user",
        principalId: granted,
        role: "viewer",
        createdBy: owner,
      });
    expect(
      await as(owner, () =>
        readCollectionSharing({ ownerEmail: owner, orgId }, made.id),
      ),
    ).toEqual({
      workspaceRole: null,
      users: [{ email: granted, role: "viewer" }],
    });
    await getDb()
      .delete(schema.collectionShares)
      .where(eq(schema.collectionShares.resourceId, made.id));
  });

  it("a recipient's project count never includes the owner's private projects", async () => {
    const made = await create({
      name: "QA count leak",
      sharing: { workspaceRole: "member" },
    });
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA private draft",
    });
    await as(owner, () =>
      addProjectToCollection.run(
        { projectId: project.id, collectionId: made.id },
        context(owner, orgId),
      ),
    );
    const mine = (await listAs(owner)).find((c) => c.id === made.id);
    const theirs = (await listAs(bystander)).find((c) => c.id === made.id);
    expect(mine?.projectCount).toBe(1);
    expect(theirs?.projectCount).toBe(0);
  });

  it("sharing grants are readable only by the owner or a Manager", async () => {
    const made = await create({
      name: "QA grants read",
      sharing: {
        users: [
          { email: granted, role: "manager" },
          { email: bystander, role: "member" },
        ],
      },
    });
    const scopeOf = (email: string, org = orgId) => ({
      ownerEmail: email,
      orgId: org,
    });
    expect(
      (await readCollectionSharing(scopeOf(granted), made.id)).users,
    ).toHaveLength(2);
    await expect(
      readCollectionSharing(scopeOf(bystander), made.id),
    ).rejects.toMatchObject({ code: "analytics_collection_forbidden" });
    await expect(
      readCollectionSharing(scopeOf(foreign, foreignOrgId), made.id),
    ).rejects.toMatchObject({ code: "analytics_collection_not_found" });
  });

  it("a Manager manages members through the framework share action", async () => {
    const made = await create({
      name: "QA manager members",
      sharing: { users: [{ email: granted, role: "manager" }] },
    });
    await as(granted, () =>
      shareResource.run(
        {
          resourceType: "analytics-collection",
          resourceId: made.id,
          principalType: "user",
          principalId: bystander,
          role: "editor",
        },
        context(granted, orgId),
      ),
    );
    expect((await listAs(bystander)).some((c) => c.id === made.id)).toBe(true);
    await expect(
      as(bystander, () =>
        shareResource.run(
          {
            resourceType: "analytics-collection",
            resourceId: made.id,
            principalType: "user",
            principalId: foreign,
            role: "editor",
          },
          context(bystander, orgId),
        ),
      ),
    ).rejects.toThrow();
  });

  it("a workspace Manager grant lets any member file their own project", async () => {
    const made = await create({
      name: "QA workspace manager",
      sharing: { workspaceRole: "manager" },
    });
    const theirs = await createProject({
      ownerEmail: bystander,
      orgId,
      title: "QA workspace-manager project",
    });
    await as(bystander, () =>
      addProjectToCollection.run(
        { projectId: theirs.id, collectionId: made.id },
        context(bystander, orgId),
      ),
    );
    const listed = await as(bystander, () =>
      listProjects.run(
        { view: "active", search: "", collectionId: made.id },
        context(bystander, orgId),
      ),
    );
    expect(listed.projects.map((p) => p.id)).toEqual([theirs.id]);
  });

  it("a recipient lists only the readable projects in a shared collection", async () => {
    const made = await create({
      name: "QA recipient routing",
      sharing: { users: [{ email: granted, role: "member" }] },
    });
    const privateProject = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA stays private",
    });
    const sharedProject = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA explicitly shared",
    });
    for (const project of [privateProject, sharedProject]) {
      await as(owner, () =>
        addProjectToCollection.run(
          { projectId: project.id, collectionId: made.id },
          context(owner, orgId),
        ),
      );
    }
    await getDb()
      .insert(schema.projectShares)
      .values({
        id: `pshare_${randomUUID()}`,
        resourceId: sharedProject.id,
        principalType: "user",
        principalId: granted,
        role: "viewer",
        createdBy: owner,
      });
    const read = (email: string, org = orgId) =>
      as(
        email,
        () =>
          listProjects.run(
            { view: "active", search: "", collectionId: made.id },
            context(email, org),
          ),
        org,
      );
    expect(
      (await read(granted)).projects.map((p) => [p.id, p.yourAccess]),
    ).toEqual([[sharedProject.id, "read"]]);
    expect((await read(owner)).projects).toHaveLength(2);
    await expect(read(bystander)).rejects.toMatchObject({
      code: "analytics_collection_not_found",
    });
    await expect(read(foreign, foreignOrgId)).rejects.toMatchObject({
      code: "analytics_collection_not_found",
    });
    await as(owner, () =>
      unshareResource.run(
        {
          resourceType: "analytics-collection",
          resourceId: made.id,
          principalType: "user",
          principalId: granted,
        },
        context(owner, orgId),
      ),
    );
    await expect(read(granted)).rejects.toMatchObject({
      code: "analytics_collection_not_found",
    });
  });
});

describe("filing a readable project as a collection Manager", () => {
  const shareProject = (projectId: string, email: string) =>
    getDb()
      .insert(schema.projectShares)
      .values({
        id: `pshare_${randomUUID()}`,
        resourceId: projectId,
        principalType: "user",
        principalId: email,
        role: "viewer",
        createdBy: owner,
      });
  const projectGrantCount = async (projectId: string) =>
    (
      await getDb()
        .select({ id: schema.projectShares.id })
        .from(schema.projectShares)
        .where(eq(schema.projectShares.resourceId, projectId))
    ).length;
  const file = (email: string, projectId: string, collectionId: string) =>
    as(email, () =>
      addProjectToCollection.run(
        { projectId, collectionId },
        context(email, orgId),
      ),
    );
  const unfile = (email: string, projectId: string, collectionId: string) =>
    as(email, () =>
      removeProjectFromCollection.run(
        { projectId, collectionId },
        context(email, orgId),
      ),
    );
  const assignments = (email: string) =>
    as(email, () => listProjectCollections.run({}, context(email, orgId))).then(
      (result) => result.assignments,
    );

  it("files and removes an independently readable project without a new grant", async () => {
    const made = await create({
      name: "QA manager links",
      sharing: { users: [{ email: granted, role: "manager" }] },
    });
    const theirs = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA readable by manager",
    });
    await shareProject(theirs.id, granted);
    const before = await projectGrantCount(theirs.id);
    await file(granted, theirs.id, made.id);
    expect(await projectGrantCount(theirs.id)).toBe(before);
    expect(
      (await assignments(granted)).find((a) => a.projectId === theirs.id),
    ).toMatchObject({ collectionIds: [made.id] });
    await unfile(granted, theirs.id, made.id);
    expect(
      (await assignments(granted)).find((a) => a.projectId === theirs.id),
    ).toBeUndefined();
    expect(await projectGrantCount(theirs.id)).toBe(before);
  });

  it("denies a private project, a collection Member, a workspace viewer and a foreign workspace", async () => {
    const made = await create({
      name: "QA link denials",
      sharing: {
        users: [
          { email: granted, role: "manager" },
          { email: bystander, role: "member" },
          { email: viewerOnly, role: "manager" },
        ],
      },
    });
    const hidden = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA private to owner",
    });
    await expect(file(granted, hidden.id, made.id)).rejects.toThrow(
      /not in this workspace/,
    );
    const readable = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA readable to many",
    });
    for (const email of [granted, bystander, viewerOnly])
      await shareProject(readable.id, email);
    await expect(file(bystander, readable.id, made.id)).rejects.toThrow(
      /permission/,
    );
    await expect(file(viewerOnly, readable.id, made.id)).rejects.toThrow();
    await expect(
      as(
        foreign,
        () =>
          addProjectToCollection.run(
            { projectId: readable.id, collectionId: made.id },
            context(foreign, foreignOrgId),
          ),
        foreignOrgId,
      ),
    ).rejects.toThrow();
    await file(granted, readable.id, made.id);
    await expect(unfile(bystander, readable.id, made.id)).rejects.toThrow(
      /permission/,
    );
    await expect(unfile(viewerOnly, readable.id, made.id)).rejects.toThrow();
    expect(
      (await assignments(granted)).find((a) => a.projectId === readable.id)
        ?.collectionIds,
    ).toEqual([made.id]);
  });
});

describe("project-to-collection assignments need project and collection read", () => {
  it("a recipient sees an assignment only while both are readable; no ids after revocation", async () => {
    const open = await create({
      name: "QA assignment open",
      sharing: { users: [{ email: granted, role: "member" }] },
    });
    const closed = await create({ name: "QA assignment closed" });
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA assigned project",
    });
    const hidden = await createProject({
      ownerEmail: owner,
      orgId,
      title: "QA assigned but private",
    });
    for (const collectionId of [open.id, closed.id]) {
      for (const p of [project, hidden]) {
        await as(owner, () =>
          addProjectToCollection.run(
            { projectId: p.id, collectionId },
            context(owner, orgId),
          ),
        );
      }
    }
    await getDb()
      .insert(schema.projectShares)
      .values({
        id: `pshare_${randomUUID()}`,
        resourceId: project.id,
        principalType: "user",
        principalId: granted,
        role: "viewer",
        createdBy: owner,
      });
    const read = (email: string) =>
      as(email, () =>
        listProjectCollections.run({}, context(email, orgId)),
      ).then((result) => result.assignments);
    expect(
      (await read(granted)).filter((a) =>
        [project.id, hidden.id].includes(a.projectId),
      ),
    ).toEqual([{ projectId: project.id, collectionIds: [open.id] }]);
    const owned = (await read(owner)).find((a) => a.projectId === project.id);
    expect([...(owned?.collectionIds ?? [])].sort()).toEqual(
      [open.id, closed.id].sort(),
    );
    await as(owner, () =>
      unshareResource.run(
        {
          resourceType: "analytics-collection",
          resourceId: open.id,
          principalType: "user",
          principalId: granted,
        },
        context(owner, orgId),
      ),
    );
    const after = JSON.stringify(await read(granted));
    expect(after).not.toContain(open.id);
    expect(after).not.toContain(closed.id);
  });
});

describe("collection privacy summary counts individual users", () => {
  it("the owner sees every selected user; a recipient excludes their own grant; workspace wins", async () => {
    const made = await create({
      name: "QA user summary",
      sharing: {
        users: [
          { email: granted, role: "member" },
          { email: bystander, role: "member" },
        ],
      },
    });
    const pick = async (email: string, id: string) =>
      (await listAs(email)).find((c) => c.id === id);
    expect(await pick(owner, made.id)).toMatchObject({
      sharedWithUserCount: 2,
      sharedWithWorkspace: false,
    });
    expect(await pick(granted, made.id)).toMatchObject({
      sharedWithUserCount: 1,
    });
    const solo = await create({
      name: "QA solo summary",
      sharing: { users: [{ email: granted, role: "member" }] },
    });
    expect(await pick(granted, solo.id)).toMatchObject({
      sharedWithUserCount: 0,
    });
    expect(await pick(owner, solo.id)).toMatchObject({
      sharedWithUserCount: 1,
    });
    const both = await create({
      name: "QA workspace precedence",
      sharing: {
        workspaceRole: "member",
        users: [{ email: granted, role: "member" }],
      },
    });
    expect(await pick(owner, both.id)).toMatchObject({
      sharedWithWorkspace: true,
      sharedWithUserCount: 1,
    });
  });
});
