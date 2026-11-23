import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { inArray } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { deleteOrgSetting, putOrgSetting } from "@agent-native/core/settings";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { statuses } from "../server/db/schema.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createStatus } from "../server/model/statuses-store.js";
import { ANALYTICS_CONTROL_IDS as controls } from "../shared/analytics-control-ids.js";
import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";
import createDataStatus from "./create-data-status.js";
import createWarehouse from "./create-workspace-warehouse-form.js";
import getDataBrowserAccess from "./get-data-browser-access.js";
import getDataBrowserCatalog from "./get-data-browser-catalog.js";
import getContextSetup from "./get-workspace-context-setup.js";
import listDataStatuses from "./list-data-statuses.js";
import reorderDataStatus from "./reorder-data-status.js";
import runWriteback from "./run-writeback-cell.js";
import saveConnection from "./save-data-connection.js";
import updateDataStatus from "./update-data-status.js";

const round = mkdtempSync(join(tmpdir(), "data-status-actions-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "status-owner@example.test";
const manager = "status-manager@example.test";
const viewer = "status-viewer@example.test";
const explorer = "status-explorer@example.test";
const orgA = `qa-status-a-${randomUUID()}`;
const orgB = `qa-status-b-${randomUUID()}`;
function asActor<T>(email: string, orgId: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA status account",
      isSyntheticTraffic: true,
    },
    call,
  );
}
const context = (email = owner, orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_data_status_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values(
      [orgA, orgB].map((id) => ({
        id,
        name: "QA status workspace",
        createdBy: owner,
        createdAt: Date.now(),
      })),
    );
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
        orgId: orgB,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: manager,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: viewer,
        role: "member",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: explorer,
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
        email: manager,
        appId: "analytics-2",
        role: "manager",
        updatedBy: owner,
        updatedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: explorer,
        appId: "analytics-2",
        role: "explorer",
        updatedBy: owner,
        updatedAt: Date.now(),
      },
    ]);
});
beforeEach(async () => {
  await getDb()
    .delete(statuses)
    .where(inArray(statuses.orgId, [orgA, orgB]));
  await deleteOrgSetting(orgA, "analytics.data.browser");
  await deleteOrgSetting(orgB, "analytics.data.browser");
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
    owned.startsWith(temporary + "/data-status-actions-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("workspace default status", () => {
  it("rejects member, foreign, and endorsed defaults without changing the current default", async () => {
    const { default: setDefault } =
      await import("./set-default-data-status.js");
    const local = await createStatus({
      ownerEmail: owner,
      orgId: orgA,
      name: "Local",
    });
    const foreign = await createStatus({
      ownerEmail: owner,
      orgId: orgB,
      name: "Foreign",
    });
    const endorsed = await createStatus({
      ownerEmail: owner,
      orgId: orgA,
      name: "Endorsed",
      endorsed: true,
    });
    await asActor(owner, orgA, () =>
      setDefault.run({ id: local.id }, context()),
    );
    await expect(
      asActor(manager, orgA, () =>
        setDefault.run({ id: null }, context(manager)),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      asActor(owner, orgA, () => setDefault.run({ id: foreign.id }, context())),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      asActor(owner, orgA, () =>
        setDefault.run({ id: endorsed.id }, context()),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(
      (await asActor(owner, orgA, () => listDataStatuses.run({}, context())))
        .defaultStatusId,
    ).toBe(local.id);
  });
  it("applies a selected status only to newly created projects and clears it", async () => {
    const { default: setDefault } =
      await import("./set-default-data-status.js");
    const { createProject } = await import("../server/model/projects-store.js");
    const scope = { ownerEmail: owner, orgId: orgA };
    const status = await createStatus({
      ...scope,
      name: "Default",
      color: "#d64545",
    });
    const before = await createProject({ ...scope, title: "Before" });
    await asActor(owner, orgA, () =>
      setDefault.run({ id: status.id }, context()),
    );
    const after = await createProject({ ...scope, title: "After" });
    expect(before.statusId).toBeNull();
    expect(after.statusId).toBe(status.id);
    expect(
      (await asActor(owner, orgA, () => listDataStatuses.run({}, context())))
        .defaultStatusId,
    ).toBe(status.id);
    await asActor(owner, orgA, () => setDefault.run({ id: null }, context()));
    const cleared = await createProject({ ...scope, title: "Cleared" });
    expect(cleared.statusId).toBeNull();
  });
});

describe("data status catalogue authority", () => {
  it("lists all 66 shared workspace statuses without leaking another organisation", async () => {
    const ids: string[] = [];
    for (let index = 1; index <= 66; index++) {
      ids.push(
        (
          await createStatus({
            ownerEmail: owner,
            orgId: orgA,
            name: `QA test status ${String(index).padStart(2, "0")}`,
          })
        ).id,
      );
    }
    const foreign = await createStatus({
      ownerEmail: owner,
      orgId: orgB,
      name: "QA other status",
    });
    const read = await asActor(manager, orgA, () =>
      listDataStatuses.run({}, context(manager)),
    );
    expect(read.statuses).toHaveLength(66);
    expect(new Set(read.statuses.map((status) => status.id))).toEqual(
      new Set(ids),
    );
    expect(read.statuses.at(-1)?.id).toBe(ids.at(-1));
    expect(read.statuses.every((status) => !("ownerEmail" in status))).toBe(
      true,
    );
    const other = await asActor(owner, orgB, () =>
      listDataStatuses.run({}, context(owner, orgB)),
    );
    expect(other.statuses.map((status) => status.id)).toEqual([foreign.id]);
  });

  it("allows an administrator to create a persisted label with only public fields", async () => {
    const input = {
      name: "QA new data status",
      color: "#aabbcc",
      description: "QA test description",
      endorsed: true,
      inLibrary: false,
      enforcesReview: false,
    };
    const result = await asActor(owner, orgA, () =>
      createDataStatus.run(input, context()),
    );
    expect(result.status).toMatchObject(input);
    expect("ownerEmail" in result.status).toBe(false);
    const read = await asActor(manager, orgA, () =>
      listDataStatuses.run({}, context(manager)),
    );
    expect(
      read.statuses.find((status) => status.id === result.status.id),
    ).toMatchObject(input);
  });

  it("does not let an app manager create an administrator-only label", async () => {
    const before = await asActor(owner, orgA, () =>
      listDataStatuses.run({}, context()),
    );
    await expect(
      asActor(manager, orgA, () =>
        createDataStatus.run(
          { name: "QA denied status", color: "#aabbcc" },
          context(manager),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const after = await asActor(owner, orgA, () =>
      listDataStatuses.run({}, context()),
    );
    expect(after.statuses.map((status) => status.id)).toEqual(
      before.statuses.map((status) => status.id),
    );
  });

  it("never accepts caller-supplied organisation or author fields", () => {
    expect(listDataStatuses.schema.safeParse({ orgId: orgB }).success).toBe(
      false,
    );
    expect(
      createDataStatus.schema.safeParse({
        name: "QA scope",
        color: "#aabbcc",
        ownerEmail: manager,
        orgId: orgB,
      }).success,
    ).toBe(false);
  });

  it("requires the actual request identity before a read or write", async () => {
    await expect(listDataStatuses.run({}, context())).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      createDataStatus.run(
        { name: "QA no session", color: "#aabbcc" },
        context(),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("update status catalogue", () => {
  it("persists an administrator edit and rejects member and cross-workspace edits", async () => {
    const status = await createStatus({
      ownerEmail: owner,
      orgId: orgA,
      name: "Original",
      color: "#aabbcc",
    });
    const input = {
      id: status.id,
      name: "Edited",
      color: "#112233",
      description: "Reviewed",
      endorsed: true,
      inLibrary: true,
      enforcesReview: true,
    };
    await expect(
      asActor(manager, orgA, () =>
        updateDataStatus.run(input, context(manager)),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      asActor(owner, orgB, () =>
        updateDataStatus.run(input, context(owner, orgB)),
      ),
    ).rejects.toThrow();
    await asActor(owner, orgA, () => updateDataStatus.run(input, context()));
    const list = await asActor(manager, orgA, () =>
      listDataStatuses.run({}, context(manager)),
    );
    expect(list.statuses.find((item) => item.id === status.id)).toMatchObject(
      input,
    );
  });
});

describe("Data browser access presentation", () => {
  it("uses request roles for browse, annotations and administrator controls separately", async () => {
    const ownerAccess = await asActor(owner, orgA, () =>
      getDataBrowserAccess.run({}, context()),
    );
    expect(ownerAccess).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          controlId: controls.dataBrowse,
          status: "allowed",
          scope: { kind: "workspace", workspaceId: orgA },
        }),
      ]),
      canBrowseData: true,
      canManageMetadata: true,
      isAdministrator: true,
      canAddConnection: true,
      canCreateStatus: true,
      canCreateCategory: true,
      aiEnabled: true,
    });
    const managerAccess = await asActor(manager, orgA, () =>
      getDataBrowserAccess.run({}, context(manager)),
    );
    expect(managerAccess).toMatchObject({
      canBrowseData: true,
      canManageMetadata: true,
      isAdministrator: false,
      canAddConnection: false,
      canCreateStatus: false,
      canCreateCategory: false,
    });
    const explorerAccess = await asActor(explorer, orgA, () =>
      getDataBrowserAccess.run({}, context(explorer)),
    );
    expect(explorerAccess).toMatchObject({
      canBrowseData: true,
      canManageMetadata: false,
      canAddConnection: false,
    });
    const viewerAccess = await asActor(viewer, orgA, () =>
      getDataBrowserAccess.run({}, context(viewer)),
    );
    expect(viewerAccess).toMatchObject({
      canBrowseData: false,
      canManageMetadata: false,
      canAddConnection: false,
    });
  });
  it("keeps workspace flags scoped to the actual selected organization", async () => {
    await putOrgSetting(orgA, "analytics.data.browser", {
      recommendedEnabled: true,
      aiEnabled: false,
      allowNewConnections: false,
    });
    const first = await asActor(owner, orgA, () =>
      getDataBrowserAccess.run({}, context()),
    );
    expect(first).toMatchObject({
      aiEnabled: false,
      canAddConnection: false,
    });
    expect(first).not.toHaveProperty("recommendedEnabled");
    const other = await asActor(owner, orgB, () =>
      getDataBrowserAccess.run({}, context(owner, orgB)),
    );
    expect(other).toMatchObject({
      aiEnabled: true,
      canAddConnection: true,
    });
    expect(other).not.toHaveProperty("recommendedEnabled");
  });
  it("rejects forged scope, missing actual identity and membership in an unjoined workspace", async () => {
    expect(getDataBrowserAccess.schema.safeParse({ orgId: orgB }).success).toBe(
      false,
    );
    await expect(getDataBrowserAccess.run({}, context())).rejects.toMatchObject(
      { statusCode: 401 },
    );
    await expect(
      asActor(manager, orgB, () =>
        getDataBrowserAccess.run({}, context(manager, orgB)),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("reads the sample catalog for a permitted browser and refuses a direct viewer read", async () => {
    const input = { connectionId: SAMPLE_DATA_SOURCE_ID, first: 1 };
    const catalog = await asActor(explorer, orgA, () =>
      getDataBrowserCatalog.run(input, context(explorer)),
    );
    expect(catalog).toMatchObject({
      connectionId: SAMPLE_DATA_SOURCE_ID,
      refreshState: "ready",
    });
    await expect(
      asActor(viewer, orgA, () =>
        getDataBrowserCatalog.run(input, context(viewer)),
      ),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "access_denied" });
  });

  it("reads saved Context Setup progress for an Explorer and denies the Viewer action", async () => {
    await putOrgSetting(orgA, "analytics.context.setup", {
      rulesAdded: true,
      referenceRepositoryAdded: true,
    });
    await expect(
      asActor(explorer, orgA, () => getContextSetup.run({}, context(explorer))),
    ).resolves.toEqual({
      completedSteps: ["improve", "reference"],
      progressPercent: (2 / 6) * 100,
    });
    await expect(
      asActor(viewer, orgA, () => getContextSetup.run({}, context(viewer))),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "access_denied" });
    await expect(
      asActor(owner, orgB, () => getContextSetup.run({}, context(owner, orgB))),
    ).resolves.toEqual({ completedSteps: [], progressPercent: 0 });
  });

  it("refuses legacy warehouse creation after the enabled decision is revoked", async () => {
    const initial = await asActor(owner, orgA, () =>
      getDataBrowserAccess.run({}, context()),
    );
    expect(initial.capabilities).toContainEqual(
      expect.objectContaining({
        controlId: controls.bigQueryConnectionCreate,
        status: "allowed",
      }),
    );
    await putOrgSetting(orgA, "analytics.data.browser", {
      allowNewConnections: false,
    });
    await expect(
      asActor(owner, orgA, () =>
        saveConnection.run(
          {
            requestId: randomUUID(),
            type: "bigquery",
            draft: true,
            values: { name: "QA warehouse", projectId: "qa-project" },
          },
          context(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "access_denied" });
  });

  it("refuses the native warehouse form before credential validation when creation is disabled", async () => {
    await putOrgSetting(orgA, "analytics.data.browser", {
      allowNewConnections: false,
    });
    await expect(
      asActor(owner, orgA, () =>
        createWarehouse.run(
          {
            requestId: randomUUID(),
            type: "bigquery",
            draft: false,
            values: {
              name: "QA warehouse",
              projectId: "qa-project",
              serviceAccount: "synthetic provider boundary fixture",
              queryAccessGroupIds: ["workspace"],
              viewAccessGroupIds: ["workspace"],
            },
          },
          context(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "access_denied" });
  });

  it("refuses direct warehouse Writeback with the projected missing backing reason", async () => {
    const { capabilities } = await asActor(owner, orgA, () =>
      getDataBrowserAccess.run({}, context()),
    );
    expect(capabilities).toContainEqual(
      expect.objectContaining({
        controlId: controls.writeback,
        status: "unavailable",
        reason: "missing_backing",
      }),
    );
    await expect(
      asActor(owner, orgA, () =>
        runWriteback.run(
          {
            projectId: "qa-project",
            cellId: "qa-cell",
            targetTable: "analytics.output",
          },
          context(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404, errorCode: "missing_backing" });
  });
});

describe("effective status administration", () => {
  it("does not grant raw owner authority to an org-member delegated request", async () => {
    await runWithRequestContext(
      {
        userEmail: owner,
        orgId: orgA,
        authUserId: owner,
        userName: "QA delegated account",
        a2aIdentityAssurance: "org-member",
      },
      async () => {
        const access = await getDataBrowserAccess.run({}, context());
        expect(access).toMatchObject({
          isAdministrator: false,
          canCreateStatus: false,
          canCreateCategory: false,
          canAddConnection: false,
        });
        const before = await listDataStatuses.run({}, context());
        await expect(
          createDataStatus.run(
            { name: "QA denied delegated", color: "#aabbcc" },
            context(),
          ),
        ).rejects.toMatchObject({ statusCode: 403 });
        const after = await listDataStatuses.run({}, context());
        expect(after.statuses.map((status) => status.id)).toEqual(
          before.statuses.map((status) => status.id),
        );
      },
    );
  });
  it("accepts a real color value and refuses arbitrary CSS or blank colors", () => {
    for (const color of [" ", "red", "url(example)", "#1234567", "#12345g"]) {
      expect(
        createDataStatus.schema.safeParse({ name: "QA color", color }).success,
      ).toBe(false);
    }
    expect(
      createDataStatus.schema.safeParse({ name: "QA color", color: "#aabbcc" })
        .success,
    ).toBe(true);
  });
  it("preserves a typed conflict and does not insert another same-name status", async () => {
    const input = { name: "QA duplicate status", color: "#aabbcc" };
    const first = await asActor(owner, orgB, () =>
      createDataStatus.run(input, context(owner, orgB)),
    );
    await expect(
      asActor(owner, orgB, () =>
        createDataStatus.run(input, context(owner, orgB)),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "analytics_status_name_conflict",
      errorCode: "analytics_status_name_conflict",
    });
    const read = await asActor(owner, orgB, () =>
      listDataStatuses.run({}, context(owner, orgB)),
    );
    expect(
      read.statuses
        .filter((status) => status.name === input.name)
        .map((status) => status.id),
    ).toEqual([first.status.id]);
  });
});

describe("reorder status catalogue", () => {
  it("persists a complete ordering and rejects stale, duplicate, foreign and member requests", async () => {
    const a = await createStatus({
      ownerEmail: owner,
      orgId: orgA,
      name: "Alpha",
    });
    const b = await createStatus({
      ownerEmail: owner,
      orgId: orgA,
      name: "Beta",
    });
    const foreign = await createStatus({
      ownerEmail: owner,
      orgId: orgB,
      name: "Foreign",
    });
    const reorder = (ids: string[], email = owner) =>
      asActor(email, orgA, () =>
        reorderDataStatus.run({ ids }, context(email)),
      );
    await expect(reorder([b.id, a.id], manager)).rejects.toMatchObject({
      statusCode: 403,
    });
    for (const ids of [[a.id], [a.id, a.id], [a.id, foreign.id]]) {
      await expect(reorder(ids)).rejects.toThrow();
    }
    await reorder([b.id, a.id]);
    const read = await asActor(manager, orgA, () =>
      listDataStatuses.run({}, context(manager)),
    );
    expect(read.statuses.map((item) => item.id)).toEqual([b.id, a.id]);
    expect(read.statuses.map((item) => item.sortOrder)).toEqual([0, 1]);
    const later = await createStatus({
      ownerEmail: owner,
      orgId: orgA,
      name: "Aardvark",
    });
    const afterCreate = await asActor(manager, orgA, () =>
      listDataStatuses.run({}, context(manager)),
    );
    expect(afterCreate.statuses.map((item) => item.id)).toEqual([
      b.id,
      a.id,
      later.id,
    ]);
  });
});
