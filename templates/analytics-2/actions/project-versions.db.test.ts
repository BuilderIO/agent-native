import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { withFixedClock } from "../server/model/clock.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import {
  createProject,
  listProjectVersions,
} from "../server/model/projects-store.js";
import {
  notebookHistoryInputSchema,
  restoreProjectVersionInputSchema,
  saveProjectVersionInputSchema,
} from "../shared/notebook-history.js";
import {
  notebookChangesInputSchema,
  notebookCommandSchema,
  notebookProjectInputSchema,
} from "../shared/notebook-operations.js";
import { CONTRACT_VERSION } from "../shared/notebook-snapshot-contract.js";
import applyNotebookOperation from "./apply-notebook-operation.js";
import getNotebookSnapshot from "./get-notebook-snapshot.js";
import getProject from "./get-project.js";
import listNotebookChanges from "./list-notebook-changes.js";
import listNotebookHistory from "./list-notebook-history.js";
import listProjectVersionsAction from "./list-project-versions.js";
import restoreProjectVersion from "./restore-project-version.js";
import saveProjectVersion from "./save-project-version.js";

const round = mkdtempSync(join(tmpdir(), "project-versions-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "versions-owner@example.test";
const otherOwner = "versions-other@example.test";
const orgA = `qa-versions-a-${randomUUID()}`;
const orgB = `qa-versions-b-${randomUUID()}`;

const context = (email = owner, orgId = orgA) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
});

function asActor<T>(email: string, orgId: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA versions account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

function asOwner<T>(call: () => T) {
  return asActor(owner, orgA, call);
}

async function notebook() {
  return createProject({
    ownerEmail: owner,
    orgId: orgA,
    title: "Revenue forecast",
    cells: [
      {
        kind: "markdown",
        markdown: "Original forecast",
        label: "Forecast notes",
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
      },
    ],
  });
}

async function draft(projectId: string, email = owner) {
  const input = notebookProjectInputSchema.parse({ projectId });
  const result = await asActor(email, orgA, () =>
    getNotebookSnapshot.run(input, context(email)),
  );
  if (result.status !== "accepted")
    throw new Error("Expected an accepted forecast");
  return result;
}

async function edit(projectId: string, markdown: string, email = owner) {
  const { snapshot, cells } = await draft(projectId, email);
  const cell = cells.at(0);
  if (!cell) throw new Error("Missing forecast notes");
  const command = notebookCommandSchema.parse({
    protocol: CONTRACT_VERSION,
    projectId,
    workingVersionId: snapshot.head.versionId,
    opId: randomUUID(),
    observedHead: snapshot.head,
    changes: [
      {
        type: "set-text",
        cellId: cell.id,
        expectedRevision: cell.revision,
        text: markdown,
      },
    ],
  });
  await asActor(email, orgA, () =>
    applyNotebookOperation.run(command, context(email)),
  );
}

async function grant(projectId: string, role: "editor" | "viewer") {
  await getDb().insert(schema.projectShares).values({
    id: randomUUID(),
    resourceId: projectId,
    principalType: "user",
    principalId: otherOwner,
    role,
    createdBy: owner,
    createdAt: new Date().toISOString(),
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_project_versions_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values(
      [orgA, orgB].map((id) => ({
        id,
        name: "QA versions workspace",
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
        orgId: orgA,
        email: otherOwner,
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
      {
        id: randomUUID(),
        orgId: orgA,
        email: otherOwner,
        appId: "analytics-2",
        role: "owner",
        updatedBy: owner,
        updatedAt: Date.now(),
      },
    ]);
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
    owned.startsWith(temporary + "/project-versions-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("project versions", () => {
  it("lists the autosave and each published version newest first", async () => {
    const scope = { ownerEmail: owner, orgId: orgA };
    const created = await createProject({
      ...scope,
      title: "QA versions project",
    });
    await seedLegacyPublishedProject(scope, created.id, "First publish");
    await seedLegacyPublishedProject(scope, created.id);

    const versions = await asActor(owner, orgA, () =>
      listProjectVersionsAction.run({ projectId: created.id }, context()),
    );
    expect(versions.versions).toHaveLength(3);
    expect(versions.versions.map((version) => version.kind)).toEqual([
      "published",
      "published",
      "autosave",
    ]);
    expect(versions.versions[0]?.isWorking).toBe(false);
    expect(versions.versions[0]?.isPublished).toBe(true);
    expect(versions.versions.at(-1)?.isWorking).toBe(true);
    expect(versions.versions[1]?.name).toBe("First publish");
    expect(versions.versions[0]?.number).toBe("3");
  });

  it("does not expose another member's project versions", async () => {
    const scope = { ownerEmail: otherOwner, orgId: orgA };
    const created = await createProject({
      ...scope,
      title: "Their project",
    });

    const asOwner = await asActor(owner, orgA, () =>
      listProjectVersions({ ownerEmail: owner, orgId: orgA }, created.id),
    );
    expect(asOwner).toEqual([]);

    const asThem = await asActor(otherOwner, orgA, () =>
      listProjectVersionsAction.run(
        { projectId: created.id },
        context(otherOwner, orgA),
      ),
    );
    expect(asThem.versions).toHaveLength(1);
    expect(asThem.versions[0]?.kind).toBe("autosave");
  });

  it("groups repeated edits across pages and starts a new same-actor bucket at ten minutes", async () => {
    const origin = Date.parse("2026-11-10T12:00:00.000Z");
    const at = (offset: number) => new Date(origin + offset).toISOString();
    const { id: projectId } = await withFixedClock(at(-1000), notebook);
    await grant(projectId, "editor");
    await withFixedClock(at(0), () => edit(projectId, "Initial actuals"));
    await withFixedClock(at(60_000), () =>
      edit(projectId, "Reviewed actuals", otherOwner),
    );
    const beforeCheckpoint = await draft(projectId);
    const checkpoint = await withFixedClock(at(120_000), () =>
      asOwner(() =>
        saveProjectVersion.run(
          saveProjectVersionInputSchema.parse({
            projectId,
            name: "November checkpoint",
            observedHead: beforeCheckpoint.snapshot.head,
            opId: randomUUID(),
          }),
          context(),
        ),
      ),
    );
    await withFixedClock(at(599_999), () => edit(projectId, "October comp"));
    await withFixedClock(at(600_000), () => edit(projectId, "November comp"));
    const history = (cursor?: string, filter = "all") =>
      asOwner(() =>
        listNotebookHistory.run(
          notebookHistoryInputSchema.parse({
            projectId,
            filter,
            limit: 1,
            cursor,
          }),
          context(),
        ),
      );
    const first = await history();
    expect(first.items).toMatchObject([
      {
        kind: "edits",
        actor: owner,
        startedAt: at(600_000),
        changeCount: 1,
        groups: [{ effects: [{ field: "markdown", count: 1, value: null }] }],
      },
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = await history(first.nextCursor ?? undefined);
    expect(second.items).toMatchObject([
      {
        kind: "edits",
        actor: owner,
        startedAt: at(0),
        endedAt: at(599_999),
        changeCount: 1,
        groups: [
          {
            label: "Forecast notes",
            effects: [{ field: "markdown", count: 2, value: null }],
          },
        ],
      },
    ]);
    expect(second.nextCursor).not.toBeNull();
    const third = await history(second.nextCursor ?? undefined);
    expect(third.items).toMatchObject([
      { kind: "version", version: { id: checkpoint.version.id } },
    ]);
    expect(third.nextCursor).not.toBeNull();
    const fourth = await history(third.nextCursor ?? undefined);
    expect(fourth.items).toMatchObject([
      { kind: "edits", actor: otherOwner, startedAt: at(60_000) },
    ]);
    expect(fourth.editsTruncated).toBe(false);
    expect((await history(undefined, "versions")).items).toMatchObject([
      { kind: "version", version: { id: checkpoint.version.id } },
    ]);
  });

  it("pins immutable checkpoints, rejects a stale restore and leaves the published release readable", async () => {
    const { id: projectId } = await withFixedClock(
      "2020-01-01T12:00:00.000Z",
      notebook,
    );
    await grant(projectId, "viewer");
    const published = await seedLegacyPublishedProject(
      { ownerEmail: owner, orgId: orgA },
      projectId,
    );
    const releaseId = published.publishedVersionId;
    if (!releaseId) throw new Error("Missing released forecast");
    const initial = await draft(projectId);
    const held = saveProjectVersionInputSchema.parse({
      projectId,
      name: "November accepted forecast",
      observedHead: initial.snapshot.head,
      opId: randomUUID(),
    });
    expect(
      saveProjectVersionInputSchema.safeParse({ ...held, name: "  " }).success,
    ).toBe(false);
    await edit(projectId, "Increased forecast");
    await expect(
      asOwner(() => saveProjectVersion.run(held, context())),
    ).rejects.toMatchObject({ errorCode: "project_version_changed" });
    const accepted = await draft(projectId);
    const input = { ...held, observedHead: accepted.snapshot.head };
    const saved = await asOwner(() => saveProjectVersion.run(input, context()));
    expect(saved.head).toEqual(accepted.snapshot.head);
    expect((await draft(projectId)).snapshot).toMatchObject({
      head: saved.head,
      eventSeq: saved.eventSeq,
    });
    const journal = await asOwner(() =>
      listNotebookChanges.run(
        notebookChangesInputSchema.parse({
          projectId,
          after: accepted.snapshot.eventSeq,
        }),
        context(),
      ),
    );
    expect(journal).toMatchObject({
      events: [
        {
          receipt: {
            previousHead: accepted.snapshot.head,
            nextHead: accepted.snapshot.head,
            versionChange: { type: "checkpoint", versionId: saved.version.id },
          },
        },
      ],
    });
    await edit(projectId, "Conservative forecast");
    const beforeRestore = await draft(projectId);
    expect(
      await asOwner(() => saveProjectVersion.run(input, context())),
    ).toEqual(saved);
    await expect(
      asOwner(() =>
        saveProjectVersion.run({ ...input, name: "Reused ID" }, context()),
      ),
    ).rejects.toMatchObject({ errorCode: "operation_id_reused" });
    const restore = restoreProjectVersionInputSchema.parse({
      projectId,
      versionId: saved.version.id,
      observedHead: accepted.snapshot.head,
      opId: randomUUID(),
    });
    await expect(
      asOwner(() => restoreProjectVersion.run(restore, context())),
    ).rejects.toMatchObject({ errorCode: "project_version_changed" });
    expect(await draft(projectId)).toEqual(beforeRestore);

    const restoreInput = {
      ...restore,
      observedHead: beforeRestore.snapshot.head,
    };
    const restored = await asOwner(() =>
      restoreProjectVersion.run(restoreInput, context()),
    );
    expect(restored.project.workingVersionId).not.toBe(
      beforeRestore.snapshot.head.versionId,
    );
    expect(restored.project.workingVersionId).not.toBe(saved.version.id);
    expect(restored.project.cells[0]?.contents).toMatchObject({
      markdown: "Increased forecast",
    });
    const afterRestore = await draft(projectId);
    expect(restored.head).toEqual(afterRestore.snapshot.head);
    expect(restored.eventSeq).toBe(afterRestore.snapshot.eventSeq);
    expect(
      await asOwner(() => restoreProjectVersion.run(restoreInput, context())),
    ).toEqual(restored);
    expect(await draft(projectId)).toEqual(afterRestore);
    const versions = () =>
      asOwner(() =>
        listNotebookHistory.run(
          notebookHistoryInputSchema.parse({ projectId, filter: "versions" }),
          context(),
        ),
      );
    const archivedVersionId = beforeRestore.snapshot.head.versionId;
    const archived = await asOwner(() =>
      getProject.run({ projectId, version: archivedVersionId }, context()),
    );
    expect(archived.project.appLayout).toEqual(beforeRestore.appLayout);
    expect((await versions()).items).toContainEqual(
      expect.objectContaining({
        version: expect.objectContaining({
          id: archivedVersionId,
          isWorking: false,
        }),
      }),
    );
    const afterAutosaveRetention = new Date(
      Date.parse(restored.project.updatedAt) + 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const retained = await withFixedClock(afterAutosaveRetention, versions);
    expect(retained.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        `version:${saved.version.id}`,
        `version:${releaseId}`,
      ]),
    );
    expect(retained.items.map(({ id }) => id)).not.toContain(
      `version:${archivedVersionId}`,
    );
    const release = await asActor(otherOwner, orgA, () =>
      getProject.run(
        {
          projectId,
          version: releaseId,
        },
        context(otherOwner),
      ),
    );
    expect(release.project.publishedVersionId).toBe(releaseId);
    expect(release.project.cells[0]?.contents).toMatchObject({
      markdown: "Original forecast",
    });

    const previous = await asOwner(() =>
      restoreProjectVersion.run(
        {
          ...restoreInput,
          versionId: beforeRestore.snapshot.head.versionId,
          observedHead: afterRestore.snapshot.head,
          opId: randomUUID(),
        },
        context(),
      ),
    );
    expect(previous.project.cells[0]?.contents).toMatchObject({
      markdown: "Conservative forecast",
    });
    const laterReplay = await asOwner(() =>
      restoreProjectVersion.run(restoreInput, context()),
    );
    expect(laterReplay.head).toEqual(restored.head);
    expect(laterReplay.eventSeq).toBe(restored.eventSeq);
    expect(laterReplay.project.draftHead).toEqual(previous.head);
    const named = await asOwner(() =>
      getProject.run({ projectId, version: saved.version.id }, context()),
    );
    expect(named.project.cells[0]?.contents).toMatchObject({
      markdown: "Increased forecast",
    });
  });
});
