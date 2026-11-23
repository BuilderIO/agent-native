import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  closeDbExec,
  getDbExec,
  runMigrations,
  sql,
} from "@agent-native/core/db";
import { and, eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProjectsListView } from "../app/components/projects/ProjectsListView.js";
import { i18nCatalog } from "../app/i18n/index.js";
import { resolveRoute } from "../app/routes/routing/registry.js";
import { getDb, schema } from "../server/db/index.js";
import { withFixedClock } from "../server/model/clock.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import {
  listProjects,
  getProjectDocument,
} from "../server/model/projects-store.js";
import applyNotebookOperation from "./apply-notebook-operation.js";
import createProjectAction from "./create-project.js";
import getNotebookSnapshot from "./get-notebook-snapshot.js";
import getProjectCreation from "./get-project-creation.js";
import getProject from "./get-project.js";
import listProjectsAction from "./list-projects.js";

const round = mkdtempSync(join(tmpdir(), "create-project-atomic-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "add-cell-owner@example.test";
const orgId = `qa-add-cell-${randomUUID()}`;
const editor = "create-project-editor@example.test";

const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};

function asActor<T>(call: () => T, email = owner) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA add-cell account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_add_cell_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA add-cell workspace",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: editor,
    role: "member",
    joinedAt: Date.now(),
  });
  await getDb()
    .insert(appMemberRoles)
    .values(
      (
        [
          [owner, "owner"],
          [editor, "editor"],
        ] as const
      ).map(([email, role]) => ({
        id: randomUUID(),
        orgId,
        email,
        appId: "analytics-2",
        role,
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
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/create-project-atomic-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("A2-NEW-PROJECT-PARTIAL-WRITE", () => {
  it("validates before writing, then creates exactly one project with its description", async () => {
    const input = {
      title: "Atomic project",
      description: "A complete project",
    };
    expect(
      createProjectAction.schema.safeParse({
        ...input,
        description: "x".repeat(1001),
      }).success,
    ).toBe(false);
    expect(await listProjects({ ownerEmail: owner, orgId })).toHaveLength(0);
    const parsed = createProjectAction.schema.parse(input);
    const result = await asActor(() =>
      createProjectAction.run(parsed, context),
    );
    const projects = await listProjects({ ownerEmail: owner, orgId });
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: result.id,
      title: input.title,
      description: input.description,
    });
    expect(
      await getProjectDocument({ ownerEmail: owner, orgId }, result.id),
    ).toMatchObject(input);
  });

  it("creates a complete ordered notebook and rejects inaccessible connections before writing", async () => {
    const base = {
      label: null,
      hidden: false,
      gridX: 0,
      gridY: 0,
      gridWidth: 6,
      gridHeight: 2,
    };
    const cells = [
      {
        ...base,
        kind: "input" as const,
        name: "range",
        inputType: "DROPDOWN" as const,
        defaultValueString: "90d",
        options: ["90d", "30d"],
        optional: false,
      },
      {
        ...base,
        kind: "sql" as const,
        source: "SELECT 1 AS n",
        dataConnectionId: null,
        databaseSchema: null,
        resultVariable: "data",
        outputResult: true,
      },
      {
        ...base,
        kind: "chart" as const,
        dataframe: "data",
        chartSpec: {
          mark: "bar" as const,
          xField: "n",
          yField: "n",
          seriesField: null,
          title: "Result",
        },
      },
    ];
    const before = await listProjects({ ownerEmail: owner, orgId });
    const rejected = createProjectAction.schema.parse({
      title: "Denied",
      cells: [
        cells[1] && { ...cells[1], dataConnectionId: "missing-connection" },
      ],
    });
    await expect(
      asActor(() => createProjectAction.run(rejected, context)),
    ).rejects.toThrow();
    expect(await listProjects({ ownerEmail: owner, orgId })).toHaveLength(
      before.length,
    );
    const parsed = createProjectAction.schema.parse({
      title: "Complete notebook",
      cells,
    });
    const result = await asActor(() =>
      createProjectAction.run(parsed, context),
    );
    const document = await getProjectDocument(
      { ownerEmail: owner, orgId },
      result.id,
    );
    expect(
      document?.cells.map((cell) => {
        const { id: _id, order: _order, ...contents } = cell.contents;
        return contents;
      }),
    ).toEqual(cells);
  });

  it("rolls back the project and creation receipt when the first working version insert fails", async () => {
    const requestId = randomUUID();
    const title = "Version must be present";
    const db = getDbExec();
    await db.execute(sql`
      CREATE FUNCTION qa_fail_first_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced working version failure'; END; $$;
    `);
    await db.execute(sql`
      CREATE TRIGGER qa_fail_first_version BEFORE INSERT ON analytics2_project_versions
      FOR EACH ROW EXECUTE FUNCTION qa_fail_first_version();
    `);
    try {
      await expect(
        asActor(() => createProjectAction.run({ requestId, title }, context)),
      ).rejects.toMatchObject({
        errorCode: "project_create_unreadable",
        statusCode: 503,
      });
    } finally {
      await db.execute(
        sql`DROP TRIGGER qa_fail_first_version ON analytics2_project_versions`,
      );
    }
    expect(
      await asActor(() => getProjectCreation.run({ requestId }, context)),
    ).toEqual({ status: "absent" });
    expect(
      await listProjects({ ownerEmail: owner, orgId, search: title }),
    ).toEqual([]);
    await expect(
      asActor(() => createProjectAction.run({ requestId, title }, context)),
    ).resolves.toMatchObject({ requestId });
  });

  it("deduplicates concurrent create, recovers the lost receipt after title commit and cold-opens its one Projects row", async () => {
    const requestId = randomUUID();
    const committedAt = "2026-11-18T16:27:01.487Z";
    const actor = { ...context, userEmail: editor };
    const [lostResponse, repeated] = await withFixedClock(committedAt, () =>
      Promise.all([
        asActor(() => createProjectAction.run({ requestId }, actor), editor),
        asActor(
          () =>
            createProjectAction.run(
              { requestId, starter: { kind: "empty" } },
              actor,
            ),
          editor,
        ),
      ]),
    );
    expect(repeated).toEqual(lostResponse);
    expect(repeated).toMatchObject({
      committedAt,
      snapshot: {
        snapshot: {
          head: { revision: "0", versionId: repeated.workingVersionId },
          eventSeq: "0",
        },
        resources: { metadataRevision: "0" },
        metadata: { title: "Untitled project" },
      },
    });
    expect(
      await asActor(() => getProjectCreation.run({ requestId }, context)),
    ).toEqual({ status: "absent" });
    const title = "Parity 03 – Revenue 42";
    const rename = applyNotebookOperation.schema.parse({
      protocol: 1,
      projectId: repeated.projectId,
      workingVersionId: repeated.workingVersionId,
      opId: randomUUID(),
      observedHead: repeated.snapshot.snapshot.head,
      changes: [
        {
          type: "set-metadata",
          expectedMetadataRevision: "0",
          metadata: { title },
        },
      ],
    });
    await expect(
      asActor(() => applyNotebookOperation.run(rename, actor), editor),
    ).resolves.toMatchObject({ status: "applied", eventSeq: "1" });
    const lookup = await asActor(
      () => getProjectCreation.run({ requestId }, actor),
      editor,
    );
    expect(lookup).toEqual({ status: "committed", receipt: repeated });
    await expect(
      asActor(
        () =>
          createProjectAction.run(
            { requestId, starter: { kind: "sample", sampleDataset: "orders" } },
            actor,
          ),
        editor,
      ),
    ).rejects.toMatchObject({
      errorCode: "creation_intent_reused",
      statusCode: 409,
    });
    const projects = await asActor(
      () => listProjectsAction.run({ search: title }, actor),
      editor,
    );
    expect(projects.projects).toMatchObject([
      { id: repeated.projectId, title },
    ]);
    const row = projects.projects[0];
    expect(row.untitledOrdinal).toBeUndefined();
    const markup = renderToStaticMarkup(
      createElement(AgentNativeI18nProvider, {
        catalog: i18nCatalog,
        persistPreference: false,
        children: createElement(ProjectsListView, {
          status: "ready",
          projects: projects.projects,
          currentUser: { name: "QA Editor", email: editor },
          search: "",
          onSearchChange: () => {},
        }),
      }),
    );
    const links = [
      ...markup.matchAll(
        /<a[^>]*data-rid="projects\.list\.open"[^>]*\shref="([^"]+)"[^>]*>([^<]+)<\/a>/g,
      ),
    ];
    expect(links.map((link) => [link[1], link[2]])).toEqual([
      [repeated.href, title],
    ]);
    const href = links[0][1];
    const { projectLocator } = resolveRoute(href).params;
    if (!projectLocator)
      throw new Error("Projects anchor did not resolve a project ID");
    const cold = await asActor(
      () => getProject.run({ projectId: projectLocator }, actor),
      editor,
    );
    expect(cold.project).toMatchObject({
      id: repeated.projectId,
      ownerEmail: editor,
      title,
      workingVersionId: repeated.workingVersionId,
      cells: [],
    });
    await expect(
      asActor(
        () =>
          getNotebookSnapshot.run(
            getNotebookSnapshot.schema.parse({ projectId: repeated.projectId }),
            actor,
          ),
        editor,
      ),
    ).resolves.toMatchObject({
      slug: "parity-03-revenue-42",
      metadataRevision: "1",
    });
    await expect(
      getDb()
        .select({
          id: schema.projectVersions.id,
          number: schema.projectVersions.number,
        })
        .from(schema.projectVersions)
        .where(eq(schema.projectVersions.projectId, repeated.projectId))
        .limit(2),
    ).resolves.toEqual([{ id: repeated.workingVersionId, number: "1" }]);
    await expect(
      getDb()
        .select({ projectId: schema.notebookCreationReceipts.projectId })
        .from(schema.notebookCreationReceipts)
        .where(
          and(
            eq(schema.notebookCreationReceipts.orgId, orgId),
            eq(schema.notebookCreationReceipts.principalId, editor),
          ),
        )
        .limit(2),
    ).resolves.toEqual([{ projectId: repeated.projectId }]);
    await expect(
      getDb()
        .select({ seq: schema.notebookEvents.eventSeq })
        .from(schema.notebookEvents)
        .where(eq(schema.notebookEvents.projectId, repeated.projectId))
        .limit(2),
    ).resolves.toEqual([{ seq: 1n }]);
  });

  it("records an authored title even when its text equals the generated placeholder", async () => {
    const created = await asActor(() =>
      createProjectAction.run({ requestId: randomUUID() }, context),
    );
    const title = created.snapshot.metadata.title;
    expect(title).toBe("Untitled project");
    const read = () =>
      asActor(() => getProject.run({ projectId: created.projectId }, context));
    expect((await read()).project.untitledOrdinal).toBe(1);
    const command = applyNotebookOperation.schema.parse({
      protocol: 1,
      projectId: created.projectId,
      workingVersionId: created.workingVersionId,
      opId: randomUUID(),
      observedHead: created.snapshot.snapshot.head,
      changes: [
        {
          type: "set-metadata",
          expectedMetadataRevision: "0",
          metadata: { title },
        },
      ],
    });
    await expect(
      asActor(() => applyNotebookOperation.run(command, context)),
    ).resolves.toMatchObject({ status: "applied", eventSeq: "1" });
    const saved = await read();
    expect(saved.project.title).toBe(title);
    expect(saved.project.untitledOrdinal).toBeUndefined();
  });

  it("assigns available default titles across concurrent distinct intents and checks current permissions on recovery", async () => {
    const actor = { ...context, userEmail: editor };
    const submitted = await Promise.all(
      Array.from({ length: 2 }, () =>
        asActor(
          () => createProjectAction.run({ requestId: randomUUID() }, actor),
          editor,
        ),
      ),
    );
    expect(
      submitted.map(({ snapshot }) => snapshot.metadata.title).sort(),
    ).toEqual(["Untitled project", "Untitled project (2)"]);
    const requestId = submitted[0]?.requestId;
    if (!requestId) throw new Error("Missing first creation");
    await getDb()
      .update(appMemberRoles)
      .set({ role: "viewer" })
      .where(
        and(eq(appMemberRoles.orgId, orgId), eq(appMemberRoles.email, editor)),
      );
    await expect(
      asActor(() => getProjectCreation.run({ requestId }, actor), editor),
    ).rejects.toMatchObject({
      errorCode: "project_create_denied",
      statusCode: 403,
    });
    await expect(
      asActor(() => createProjectAction.run({ requestId }, actor), editor),
    ).rejects.toMatchObject({
      errorCode: "project_create_denied",
      statusCode: 403,
    });
  });
});
