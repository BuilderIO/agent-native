import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "@agent-native/core/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CellDraft } from "../../app/lib/model/contracts.js";

const databasePath = join(
  tmpdir(),
  `analytics2-repair-${process.pid}-${Date.now()}.pglite`,
);
const previousDatabaseUrl = process.env.DATABASE_URL;
const owner = "repair-owner@example.test";
const orgA = "org-repair-a";
const orgB = "org-repair-b";

let store: typeof import("./projects-store.js");
let cellsStore: typeof import("./cells-store.js");
let runsStore: typeof import("./runs-store.js");
let collectionsStore: typeof import("./collections-store.js");
let statusesStore: typeof import("./statuses-store.js");
let dbModule: typeof import("../db/index.js");
let schemaModule: typeof import("../db/schema.js");

const scopeA = { ownerEmail: owner, orgId: orgA };
const scopeB = { ownerEmail: owner, orgId: orgB };

const base = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};

function markdown(id: string, markdown: string): CellDraft {
  return { ...base, id, kind: "markdown", markdown };
}

function sql(id: string, source: string, resultVariable: string): CellDraft {
  return {
    ...base,
    id,
    kind: "sql",
    source,
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable,
    outputResult: true,
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  await (await import("../plugins/db.js")).default();
  store = await import("./projects-store.js");
  cellsStore = await import("./cells-store.js");
  runsStore = await import("./runs-store.js");
  collectionsStore = await import("./collections-store.js");
  statusesStore = await import("./statuses-store.js");
  dbModule = await import("../db/index.js");
  schemaModule = await import("../db/schema.js");
}, 180_000);

afterAll(async () => {
  try {
    await (await import("@agent-native/core/db")).closeDbExec();
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    rmSync(databasePath, { recursive: true, force: true });
  }
});

describe("workspace scope", () => {
  it("refuses a scope without an organisation", async () => {
    await expect(
      store.listProjects({ ownerEmail: owner } as never),
    ).rejects.toMatchObject({ code: "workspace_scope_required" });
    await expect(
      store.listProjects({ orgId: orgA } as never),
    ).rejects.toMatchObject({ code: "workspace_scope_required" });
  });

  it("keeps the same account separate across organisations", async () => {
    const project = await store.createProject({
      ...scopeA,
      title: "Org A only",
      cells: [markdown("cel_org_a", "org a secret")],
    });

    expect(await store.listProjects(scopeB)).toEqual([]);
    expect(await store.getProjectDocument(scopeB, project.id)).toBeNull();
    await expect(
      store.updateProject({
        ...scopeB,
        projectId: project.id,
        title: "cross-org hijack",
      }),
    ).rejects.toThrow();
    await expect(
      cellsStore.readCells(scopeB, project.id, project.workingVersionId),
    ).rejects.toMatchObject({ code: "analytics_project_not_found" });
    await expect(runsStore.listRuns(scopeB, project.id)).rejects.toMatchObject({
      code: "analytics_project_not_found",
    });

    const stillThere = await store.getProjectDocument(scopeA, project.id);
    expect(stillThere?.title).toBe("Org A only");
  });

  it("keeps a private peer's project out of the same organisation", async () => {
    const peer = "repair-peer@example.test";
    const project = await store.createProject({
      ownerEmail: peer,
      orgId: orgA,
      title: "Peer private",
      cells: [markdown("cel_peer", "peer secret")],
    });

    const visible = await store.listProjects(scopeA);
    expect(visible.some((row) => row.id === project.id)).toBe(false);
    expect(await store.getProjectDocument(scopeA, project.id)).toBeNull();
    await expect(
      runsStore.readProjectOutputs(scopeA, project.id),
    ).rejects.toMatchObject({ code: "analytics_project_not_found" });
  });

  it("does not let a caller read another owner's cells by id", async () => {
    const project = await store.createProject({
      ...scopeA,
      title: "Cells are guarded",
      cells: [markdown("cel_guarded", "guarded")],
    });
    const other = { ownerEmail: "repair-other@example.test", orgId: orgA };
    await expect(
      cellsStore.readCells(other, project.id, project.workingVersionId),
    ).rejects.toMatchObject({ code: "analytics_project_not_found" });
    await expect(
      cellsStore.updateCell({
        ...other,
        projectId: project.id,
        versionId: project.workingVersionId,
        cellId: "cel_guarded",
        contents: markdown("cel_guarded", "hijacked") as never,
      }),
    ).rejects.toMatchObject({ code: "analytics_project_not_found" });
  });
});

describe("browser paging", () => {
  it("reaches a project beyond the old agent cap through search and cursor", async () => {
    const pageOwner = "paging@example.test";
    const pageScope = { ownerEmail: pageOwner, orgId: orgA };
    const db = dbModule.getDb();
    const rows = Array.from({ length: 501 }, (_, index) => {
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      return {
        id: `prj_page_${String(index).padStart(3, "0")}`,
        ownerEmail: pageOwner,
        orgId: orgA,
        title: index === 500 ? "Needle at the very end" : `Project ${index}`,
        description: "",
        language: "python" as const,
        statusId: null,
        favorited: false,
        trashedAt: null,
        archivedAt: null,
        lastOpenedAt: stamp,
        workingVersionId: `ver_page_${index}`,
        publishedVersionId: null,
        createdAt: stamp,
        updatedAt: stamp,
      };
    });
    await db.insert(schemaModule.projects).values(rows);

    const all = await store.listProjects(pageScope);
    expect(all).toHaveLength(501);
    expect(all[0]?.title).toBe("Needle at the very end");

    const found = await store.listProjects({
      ...pageScope,
      search: "needle at the very end",
    });
    expect(found.map((project) => project.id)).toEqual(["prj_page_500"]);

    let cursor: { updatedAt: string; id: string } | null = null;
    const seen: string[] = [];
    for (let page = 0; page < 600; page += 1) {
      const result: {
        items: Array<{ id: string; updatedAt: string }>;
        nextCursor: { updatedAt: string; id: string } | null;
      } = await store.listProjectsPage({
        ...pageScope,
        limit: 100,
        ...(cursor === null ? {} : { cursor }),
      });
      seen.push(...result.items.map((item) => item.id));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(501);
    expect(new Set(seen).size).toBe(501);
    expect(seen.at(-1)).toBe("prj_page_000");
  });
});

describe("compound writes", () => {
  it("leaves no project behind when a cell violates a constraint, then retries", async () => {
    const atomicOwner = "atomic@example.test";
    const atomicScope = { ownerEmail: atomicOwner, orgId: orgA };
    await expect(
      store.createProject({
        ...atomicScope,
        title: "Half written",
        cells: [
          markdown("cel_duplicate", "one"),
          markdown("cel_duplicate", "two"),
        ],
      }),
    ).rejects.toThrow();
    expect(await store.listProjects(atomicScope)).toEqual([]);

    const retried = await store.createProject({
      ...atomicScope,
      title: "Retried cleanly",
      cells: [
        markdown("cel_retry_one", "one"),
        markdown("cel_retry_two", "two"),
      ],
    });
    expect(retried.cells).toHaveLength(2);
    expect(await store.listProjects(atomicScope)).toHaveLength(1);
  });

  it("does not link a project to another owner's collection", async () => {
    const project = await store.createProject({
      ...scopeA,
      title: "Link guard",
      cells: [markdown("cel_link_guard", "guard")],
    });
    await expect(
      collectionsStore.addProjectToCollection({
        ...scopeA,
        projectId: project.id,
        collectionId: "col_does_not_exist",
      }),
    ).rejects.toThrow();
  });
});

describe("unreadable stored data", () => {
  it("reports a stored cell that cannot be parsed instead of returning an empty page", async () => {
    const project = await store.createProject({
      ...scopeA,
      title: "Unreadable",
      cells: [markdown("cel_readable", "readable")],
    });
    const db = dbModule.getDb();
    await db.insert(schemaModule.cells).values({
      id: "cel_unreadable",
      projectId: project.id,
      versionId: project.workingVersionId,
      kind: "markdown",
      order: "z",
      contents: "not json",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(
      cellsStore.readCells(scopeA, project.id, project.workingVersionId),
    ).rejects.toMatchObject({ code: "analytics_unreadable_stored_data" });
    await expect(
      store.getProjectDocument(scopeA, project.id),
    ).rejects.toMatchObject({ code: "analytics_unreadable_stored_data" });
  });
});

describe("run lifecycle", () => {
  it("only records terminal outcomes in the immutable run history", async () => {
    const project = await store.createProject({
      ...scopeA,
      title: "Run machine",
      cells: [sql("cel_machine", "select 1", "orders")],
    });
    await expect(
      runsStore.recordRun({
        ...scopeA,
        projectId: project.id,
        cellId: "cel_machine",
        status: "running" as never,
      }),
    ).rejects.toMatchObject({ code: "analytics_invalid_run_transition" });

    const run = await runsStore.recordRun({
      ...scopeA,
      projectId: project.id,
      cellId: "cel_machine",
      status: "complete",
      output: { type: "text", text: "ok" },
    });
    expect(run.status).toBe("complete");
    expect((await runsStore.listRuns(scopeA, project.id)).length).toBe(1);
  });

  it("refuses a stale output that would overwrite a newer run", async () => {
    const project = await store.createProject({
      ...scopeA,
      title: "Run order",
      cells: [sql("cel_order", "select 1", "orders")],
    });
    await runsStore.recordRun({
      ...scopeA,
      projectId: project.id,
      cellId: "cel_order",
      status: "complete",
      output: { type: "text", text: "newer" },
      startedAt: "2026-02-02T00:00:00.000Z",
      finishedAt: "2026-02-02T00:00:00.000Z",
    });
    await expect(
      runsStore.recordRun({
        ...scopeA,
        projectId: project.id,
        cellId: "cel_order",
        status: "complete",
        output: { type: "text", text: "older" },
        startedAt: "2026-02-01T00:00:00.000Z",
        finishedAt: "2026-02-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "analytics_invalid_run_transition" });
    const current = await runsStore.readCellOutput(
      scopeA,
      project.id,
      "cel_order",
    );
    expect(current?.output).toEqual({ type: "text", text: "newer" });
  });
});

describe("project title limit", () => {
  it("preserves the source 500-character title and rejects longer input before writing", async () => {
    const titleOwner = "title-limit@example.test";
    const titleScope = { ownerEmail: titleOwner, orgId: orgA };
    const maximum = "x".repeat(500);

    const project = await store.createProject({
      ...titleScope,
      title: maximum,
      cells: [markdown("cel_title_limit", "title")],
    });
    expect(project.title).toBe(maximum);
    expect(
      (await store.getProjectDocument(titleScope, project.id))?.title,
    ).toBe(maximum);

    const tooLong = "y".repeat(501);
    await expect(
      store.createProject({ ...titleScope, title: tooLong, cells: [] }),
    ).rejects.toMatchObject({ code: "project_title_too_long" });
    expect((await store.listProjects(titleScope)).map((row) => row.id)).toEqual(
      [project.id],
    );

    await expect(
      store.updateProject({
        ...titleScope,
        projectId: project.id,
        title: tooLong,
      }),
    ).rejects.toMatchObject({ code: "project_title_too_long" });
    expect(
      (await store.getProjectDocument(titleScope, project.id))?.title,
    ).toBe(maximum);
  });
});

describe("organisation status catalogue", () => {
  const statusOrg = "org-status-catalog";
  const statusAuthor = {
    ownerEmail: "status-author@example.test",
    orgId: statusOrg,
  };
  const statusPeer = {
    ownerEmail: "status-peer@example.test",
    orgId: statusOrg,
  };
  const statusOtherOrg = {
    ownerEmail: "status-author@example.test",
    orgId: "org-status-other",
  };

  it("shows a peer's shared status to the whole organisation and keeps the author", async () => {
    const created = await statusesStore.createStatus({
      ...statusAuthor,
      name: "Approved",
      inLibrary: true,
    });

    const peerList = await statusesStore.listStatuses(statusPeer);
    expect(peerList.map((status) => status.id)).toContain(created.id);
    expect(
      peerList.find((status) => status.id === created.id)?.ownerEmail,
    ).toBe(statusAuthor.ownerEmail);

    const otherOrgList = await statusesStore.listStatuses(statusOtherOrg);
    expect(otherOrgList.some((status) => status.id === created.id)).toBe(false);
  });

  it("allows the same author to use the same label in two organisations", async () => {
    const inFirstOrg = await statusesStore.createStatus({
      ...statusAuthor,
      name: "Shared label",
    });
    const inSecondOrg = await statusesStore.createStatus({
      ...statusOtherOrg,
      name: "Shared label",
    });
    expect(inFirstOrg.id).not.toBe(inSecondOrg.id);

    const firstList = await statusesStore.listStatuses(statusAuthor);
    const secondList = await statusesStore.listStatuses(statusOtherOrg);
    expect(firstList.some((status) => status.id === inFirstOrg.id)).toBe(true);
    expect(firstList.some((status) => status.id === inSecondOrg.id)).toBe(
      false,
    );
    expect(secondList.some((status) => status.id === inSecondOrg.id)).toBe(
      true,
    );
    expect(
      firstList.find((status) => status.id === inFirstOrg.id)?.ownerEmail,
    ).toBe(statusAuthor.ownerEmail);
    expect(
      secondList.find((status) => status.id === inSecondOrg.id)?.ownerEmail,
    ).toBe(statusAuthor.ownerEmail);
  });

  it("keeps names unique inside the organisation and lets a peer mutate a shared row", async () => {
    await expect(
      statusesStore.createStatus({ ...statusPeer, name: "Approved" }),
    ).rejects.toMatchObject({ code: "analytics_status_name_conflict" });

    const peerList = await statusesStore.listStatuses(statusPeer);
    const existing = peerList.find((status) => status.name === "Approved");
    if (existing === undefined) throw new Error("the shared status is missing");

    const updated = await statusesStore.updateStatus({
      ...statusPeer,
      statusId: existing.id,
      inLibrary: false,
    });
    expect(updated.inLibrary).toBe(false);
    expect(updated.ownerEmail).toBe(statusAuthor.ownerEmail);

    await expect(
      statusesStore.updateStatus({
        ...statusOtherOrg,
        statusId: existing.id,
        name: "hijack",
      }),
    ).rejects.toThrow(/not in this workspace/);
    await statusesStore.deleteStatus(statusOtherOrg, existing.id);
    expect(
      (await statusesStore.listStatuses(statusPeer)).some(
        (status) => status.id === existing.id,
      ),
    ).toBe(true);
  });
});

describe("status catalogue migration", () => {
  it("preserves duplicate rows by renaming them before creating the org/name index", async () => {
    const { getDbExec, sql } = await import("@agent-native/core/db");
    const { ANALYTICS_STATUS_ORG_DEDUPE_SQL } =
      await import("../db/migrations.js");
    const org = "org-status-dedupe";
    const db = dbModule.getDb();
    const exec = getDbExec();

    await exec.execute(
      sql`DROP INDEX IF EXISTS "analytics2_statuses_org_name_uq"`,
    );
    const stamp = "2026-03-01T00:00:00.000Z";
    await db.insert(schemaModule.statuses).values(
      ["a", "b", "c"].map((letter, index) => ({
        id: `sts_dedupe_${letter}`,
        ownerEmail: `dedupe-${letter}@example.test`,
        orgId: org,
        name: "Duplicate",
        description: "",
        color: null,
        endorsed: false,
        inLibrary: false,
        enforcesReview: false,
        sortOrder: 0,
        createdAt: new Date(Date.parse(stamp) + index * 60_000).toISOString(),
        updatedAt: stamp,
      })),
    );

    await exec.execute(ANALYTICS_STATUS_ORG_DEDUPE_SQL);
    await exec.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "analytics2_statuses_org_name_uq"
          ON "analytics2_statuses" ("org_id", "name")`,
    );

    const rows = await db
      .select()
      .from(schemaModule.statuses)
      .where(eq(schemaModule.statuses.orgId, org));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.name)).size).toBe(3);
    expect(rows.map((row) => row.ownerEmail).sort()).toEqual([
      "dedupe-a@example.test",
      "dedupe-b@example.test",
      "dedupe-c@example.test",
    ]);
    expect(rows.map((row) => row.name).sort()).toEqual([
      "Duplicate",
      "Duplicate (2)",
      "Duplicate (3)",
    ]);
  });
});
