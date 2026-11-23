// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  actionCallIntent,
  type ActionCaller,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  deleteAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const store = vi.hoisted(() => ({ writes: [] as unknown[][] }));

vi.mock(
  "../../../packages/core/dist/application-state/script-helpers.js",
  async (original) => ({
    ...(await original<object>()),
    resolveCurrentRequestStateTab: async () => ({
      tabId: "tab-1",
      unavailable: false,
    }),
    writeAppStateForCurrentTab: async (...args: unknown[]) => {
      store.writes.push(args);
    },
  }),
);

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject as createProjectRow } from "../server/model/projects-store.js";
import bulkUpdateProjects from "./bulk-update-projects";
import createProject from "./create-project";
import deleteProject from "./delete-project";
import favoriteProject from "./favorite-project";
import getProject from "./get-project";
import listProjects, { AGENT_PROJECT_LIST_LIMIT } from "./list-projects";
import navigate from "./navigate";
import resolveProject from "./resolve-project";
import restoreProject from "./restore-project";
import searchWorkspace from "./search-workspace";
import trashProject from "./trash-project";
import updateProject from "./update-project";

const round = mkdtempSync(join(tmpdir(), "edge-robustness-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "edge-owner@example.test";
const stranger = "edge-stranger@example.test";
const orgId = `qa-edge-${randomUUID()}`;
const AGENT_CALLERS: ActionCaller[] = ["mcp", "tool"];

function as<T>(email: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "QA edge account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

function contextFor(caller: ActionCaller, email = owner): ActionRunContext {
  return { caller, userEmail: email, orgId, appId: "analytics-2" };
}

type Runnable = {
  schema: { parse: (input: unknown) => unknown };
  run: (input: never, context: ActionRunContext) => unknown;
};

type Row = { id: string; title: string };

interface ToolResult {
  id: string;
  project: Row & {
    description: string;
    favorited: boolean;
    trashedAt: string | null;
    archivedAt: string | null;
  };
  projects: Row[];
  previous: { title: string; description: string; statusId: string | null };
  navigation: unknown;
  results: Row[];
  succeeded: number;
  failed: number;
  total: number;
  truncated: boolean;
  status: string;
  candidates: Row[];
  question: string;
}

async function call<T = ToolResult>(
  action: unknown,
  input: unknown,
  caller: ActionCaller,
  email = owner,
): Promise<T> {
  const { schema, run } = action as Runnable;
  const parsed = schema.parse(input) as never;
  return (await as(email, () => run(parsed, contextFor(caller, email)))) as T;
}

async function makeProject(title: string) {
  return createProjectRow({ ownerEmail: owner, orgId, title });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_edge_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA edge workspace",
    createdBy: owner,
    createdAt: Date.now(),
  });
  for (const email of [owner, stranger]) {
    await getDb()
      .insert(orgMembers)
      .values({
        id: randomUUID(),
        orgId,
        email,
        role: email === owner ? "owner" : "member",
        joinedAt: Date.now(),
      });
    await getDb()
      .insert(appMemberRoles)
      .values({
        id: randomUUID(),
        orgId,
        email,
        appId: "analytics-2",
        role: email === owner ? "owner" : "editor",
        updatedBy: owner,
        updatedAt: Date.now(),
      });
  }
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (owned.startsWith(resolve(tmpdir()) + "/edge-robustness-"))
    rmSync(owned, { recursive: true, force: true });
});

beforeEach(() => {
  store.writes = [];
});

describe.each(AGENT_CALLERS)("multi-step requests for caller %s", (caller) => {
  it("creates, renames, describes, stars and archives one project in a turn", async () => {
    const created = await call(
      createProject,
      { title: "Draft revenue" },
      caller,
    );
    const projectId = created.id as string;
    await call(
      updateProject,
      { projectId, title: "Revenue", description: "Weekly numbers" },
      caller,
    );
    await call(favoriteProject, { projectId, favorited: true }, caller);
    await call(
      bulkUpdateProjects,
      { projectIds: [projectId], operation: "archive" },
      caller,
    );
    const read = await call(getProject, { projectId }, caller);
    expect(read.project).toMatchObject({
      title: "Revenue",
      description: "Weekly numbers",
      favorited: true,
    });
    expect(read.project.archivedAt).not.toBeNull();
  });

  it("an update with nothing to change is refused, not reported as done", async () => {
    const project = await makeProject("Nothing to change");
    expect(
      (await actionCallIntent(updateProject, { projectId: project.id })).valid,
    ).toBe(false);
  });
});

describe.each(AGENT_CALLERS)("undo and restore for caller %s", (caller) => {
  it("restores a trashed project right away with its content intact", async () => {
    const project = await makeProject("Undo me");
    await call(trashProject, { projectId: project.id }, caller);
    const trashed = await call(listProjects, { view: "trash" }, caller);
    expect(trashed.projects.map((row: { id: string }) => row.id)).toContain(
      project.id,
    );
    const restored = await call(
      restoreProject,
      { projectId: project.id },
      caller,
    );
    expect(restored.project).toMatchObject({
      id: project.id,
      title: "Undo me",
      trashedAt: null,
    });
  });

  it("an edit reports what it replaced so the same call can undo it", async () => {
    const project = await makeProject("Before");
    const edit = await call(
      updateProject,
      { projectId: project.id, title: "After", description: "Changed" },
      caller,
    );
    expect(edit.previous).toEqual({
      title: "Before",
      description: "",
      statusId: null,
    });
    const undone = await call(
      updateProject,
      { projectId: project.id, ...edit.previous },
      caller,
    );
    expect(undone.project).toMatchObject({ title: "Before", description: "" });
  });

  it("permanent delete of a live project is a typed refusal, and the project survives", async () => {
    const project = await makeProject("Keep me");
    await expect(
      call(deleteProject, { projectId: project.id }, caller),
    ).rejects.toMatchObject({ errorCode: "project_not_trashed" });
    const read = await call(getProject, { projectId: project.id }, caller);
    expect(read.project.title).toBe("Keep me");
  });
});

describe.each(AGENT_CALLERS)("bulk operations for caller %s", (caller) => {
  it("reports each project separately when some ids are bad", async () => {
    const [a, b] = [await makeProject("Bulk A"), await makeProject("Bulk B")];
    const result = await call(
      bulkUpdateProjects,
      {
        projectIds: [a.id, "missing-project", b.id],
        operation: "trash",
      },
      caller,
    );
    expect(result).toMatchObject({ succeeded: 2, failed: 1 });
    expect(result.results).toEqual([
      { projectId: a.id, ok: true },
      expect.objectContaining({
        projectId: "missing-project",
        ok: false,
        errorCode: "project_not_found",
        statusCode: 404,
      }),
      { projectId: b.id, ok: true },
    ]);
    const trashed = await call(listProjects, { view: "trash" }, caller);
    const ids = trashed.projects.map((row: { id: string }) => row.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("applies a repeated id once and restores the whole set", async () => {
    const project = await makeProject("Bulk repeat");
    const result = await call(
      bulkUpdateProjects,
      { projectIds: [project.id, project.id], operation: "favorite" },
      caller,
    );
    expect(result.results).toHaveLength(1);
    await call(
      bulkUpdateProjects,
      { projectIds: [project.id], operation: "trash" },
      caller,
    );
    const back = await call(
      bulkUpdateProjects,
      { projectIds: [project.id], operation: "restore" },
      caller,
    );
    expect(back).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it("a project the caller cannot see fails per item as not found", async () => {
    const mine = await makeProject("Bulk private");
    const result = await call(
      bulkUpdateProjects,
      { projectIds: [mine.id], operation: "archive" },
      caller,
      stranger,
    );
    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    expect(result.results[0]).toMatchObject({
      ok: false,
      errorCode: "project_not_found",
    });
  });

  it.each([
    ["no ids", { projectIds: [], operation: "trash" }],
    [
      "101 ids",
      {
        projectIds: Array.from({ length: 101 }, (_, i) => `p${i}`),
        operation: "trash",
      },
    ],
    ["a blank id", { projectIds: [" "], operation: "trash" }],
    ["permanent deletion", { projectIds: ["p1"], operation: "delete" }],
    [
      "an unknown field",
      { projectIds: ["p1"], operation: "trash", force: true },
    ],
  ])("refuses %s with a typed error", async (_name, input) => {
    expect((await actionCallIntent(bulkUpdateProjects, input)).valid).toBe(
      false,
    );
  });
});

describe.each(AGENT_CALLERS)(
  "opening versus keeping the view for caller %s",
  (caller) => {
    it("a plain create keeps the person's view", async () => {
      const created = await call(createProject, { title: "Stay put" }, caller);
      expect(created.navigation).toEqual({ status: "kept" });
      expect(store.writes).toEqual([]);
    });

    it("create with intent open navigates", async () => {
      const created = await call(
        createProject,
        { title: "Show me", intent: "open" },
        caller,
      );
      expect(created.navigation).toEqual({ status: "requested" });
      expect(store.writes).toHaveLength(1);
    });

    it("a rename keeps the view, and a rename with intent open navigates", async () => {
      const project = await makeProject("Rename view");
      const quiet = await call(
        updateProject,
        { projectId: project.id, title: "Quiet" },
        caller,
      );
      expect(quiet.navigation).toEqual({ status: "kept" });
      expect(store.writes).toEqual([]);
      const loud = await call(
        updateProject,
        { projectId: project.id, title: "Loud", intent: "open" },
        caller,
      );
      expect(loud.navigation).toEqual({ status: "requested" });
      expect(store.writes).toHaveLength(1);
    });

    it("trash and bulk writes never navigate", async () => {
      const project = await makeProject("No jump");
      await call(trashProject, { projectId: project.id }, caller);
      await call(
        bulkUpdateProjects,
        { projectIds: [project.id], operation: "restore" },
        caller,
      );
      expect(store.writes).toEqual([]);
    });

    it("navigate with intent open on an unknown project is a typed error", async () => {
      await expect(
        call(
          navigate,
          { projectId: "missing-project", intent: "open" },
          caller,
        ),
      ).rejects.toMatchObject({ errorCode: expect.any(String) });
    });
  },
);

describe.each(AGENT_CALLERS)("ambiguous references for caller %s", (caller) => {
  beforeEach(async () => {
    await as(owner, () => deleteAppState("navigation"));
  });

  it("'that doc' resolves to the project open on screen", async () => {
    const project = await makeProject("On screen");
    await as(owner, () =>
      writeAppState("navigation", {
        view: "project",
        resourceKind: "project",
        resourceId: project.id,
      }),
    );
    const result = await call(resolveProject, { which: "current" }, caller);
    expect(result).toMatchObject({
      status: "resolved",
      source: "screen",
      project: { id: project.id },
    });
  });

  it("with nothing open it says so instead of guessing", async () => {
    const result = await call(resolveProject, { which: "current" }, caller);
    expect(result.status).toBe("none");
  });

  it("with nothing open (e.g. /home/data) it offers the last-edited project as a candidate", async () => {
    await makeProject("Older one");
    const latest = await makeProject("Newest edit");
    await call(
      updateProject,
      { projectId: latest.id, description: "touched" },
      caller,
    );
    await as(owner, () =>
      writeAppState("navigation", { view: "data", path: "/home/data" }),
    );
    const result = await call(resolveProject, { which: "current" }, caller);
    expect(result).toMatchObject({
      status: "none",
      recent: { id: latest.id },
    });
  });

  it("'the last one' is the project edited most recently", async () => {
    await makeProject("Older one");
    const latest = await makeProject("Newest edit");
    await call(
      updateProject,
      { projectId: latest.id, description: "touched" },
      caller,
    );
    const result = await call(resolveProject, { which: "recent" }, caller);
    expect(result).toMatchObject({
      status: "resolved",
      project: { id: latest.id },
    });
  });

  it("report K-ANA-4-1 'that query' with no project open is the newest notebook that has a SQL cell", async () => {
    const draftCell = {
      label: null,
      hidden: false,
      gridX: 0,
      gridY: 0,
      gridWidth: 6,
      gridHeight: 2,
    };
    const stamp = (minute: number) =>
      `2020-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`;
    const minute = caller === "mcp" ? 10 : 20;
    const query = await createProjectRow({
      ownerEmail: owner,
      orgId,
      title: `Orders by month ${caller}`,
      at: stamp(minute),
      cells: [
        {
          ...draftCell,
          kind: "sql",
          source: "select month, count(*) from orders group by 1",
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable: "data",
          outputResult: true,
        },
      ],
    });
    await createProjectRow({
      ownerEmail: owner,
      orgId,
      title: `Untitled project ${caller}`,
      at: stamp(minute + 1),
    });
    const result = await call(
      resolveProject,
      { which: "recent-query" },
      caller,
    );
    expect(result).toMatchObject({
      status: "resolved",
      source: "recent-query",
      project: { id: query.id },
    });
  });

  it("report K-ANA-4-1 says none when the member has no notebook with a SQL cell", async () => {
    const result = await call(
      resolveProject,
      { which: "recent-query" },
      caller,
      stranger,
    );
    expect(result.status).toBe("none");
  });

  it("a title fragment shared by several projects becomes a typed question", async () => {
    await makeProject(`Pipeline ${caller} east`);
    await makeProject(`Pipeline ${caller} west`);
    const result = await call(
      resolveProject,
      { reference: `pipeline ${caller}` },
      caller,
    );
    expect(result).toMatchObject({ status: "ambiguous", matches: 2 });
    expect(result.candidates).toHaveLength(2);
    expect(result.question).toEqual(expect.any(String));
  });

  it("an exact title wins over longer titles that contain it", async () => {
    const exact = await makeProject(`Churn ${caller}`);
    await makeProject(`Churn ${caller} by region`);
    const result = await call(
      resolveProject,
      { reference: `churn ${caller}` },
      caller,
    );
    expect(result).toMatchObject({
      status: "resolved",
      source: "title",
      project: { id: exact.id },
    });
  });

  it("a reference nothing matches is none, not a fake hit", async () => {
    const result = await call(
      resolveProject,
      { reference: "zzz no such project" },
      caller,
    );
    expect(result.status).toBe("none");
  });

  it.each([
    ["neither which nor reference", {}],
    ["both which and reference", { which: "recent", reference: "x" }],
    ["a made-up which", { which: "oldest" }],
  ])("refuses %s", async (_name, input) => {
    expect((await actionCallIntent(resolveProject, input)).valid).toBe(false);
  });
});

describe.each(AGENT_CALLERS)("concurrent edits for caller %s", (caller) => {
  it("an agent description and a person's title edit made together both land", async () => {
    const project = await makeProject("Concurrent");
    await Promise.all([
      call(
        updateProject,
        { projectId: project.id, title: "Renamed by person" },
        "frontend",
      ),
      call(
        updateProject,
        { projectId: project.id, description: "Written by agent" },
        caller,
      ),
    ]);
    const read = await call(getProject, { projectId: project.id }, caller);
    expect(read.project).toMatchObject({
      title: "Renamed by person",
      description: "Written by agent",
    });
  });

  it("several agent edits to different fields in flight at once all land", async () => {
    const project = await makeProject("Burst");
    await Promise.all([
      call(updateProject, { projectId: project.id, title: "Burst 2" }, caller),
      call(
        updateProject,
        { projectId: project.id, description: "Burst note" },
        caller,
      ),
      call(favoriteProject, { projectId: project.id, favorited: true }, caller),
    ]);
    const read = await call(getProject, { projectId: project.id }, caller);
    expect(read.project).toMatchObject({
      title: "Burst 2",
      description: "Burst note",
      favorited: true,
    });
  });
});

describe.each(AGENT_CALLERS)(
  "invalid ids and permissions for caller %s",
  (caller) => {
    it.each([
      ["get-project", getProject, {}],
      ["update-project", updateProject, { title: "x" }],
      ["trash-project", trashProject, {}],
      ["restore-project", restoreProject, {}],
      ["archive via favorite-project", favoriteProject, { favorited: true }],
    ] as const)(
      "%s on an unknown id is project_not_found",
      async (_name, action, extra) => {
        await expect(
          call(action, { projectId: "no-such-project", ...extra }, caller),
        ).rejects.toMatchObject({
          errorCode: "project_not_found",
          statusCode: 404,
        });
      },
    );

    it("another member's project reads as not found, never as success", async () => {
      const project = await makeProject("Not yours");
      await expect(
        call(getProject, { projectId: project.id }, caller, stranger),
      ).rejects.toMatchObject({ errorCode: "project_not_found" });
      await expect(
        call(
          updateProject,
          { projectId: project.id, title: "Stolen" },
          caller,
          stranger,
        ),
      ).rejects.toMatchObject({ errorCode: "project_not_found" });
      const read = await call(getProject, { projectId: project.id }, caller);
      expect(read.project.title).toBe("Not yours");
    });

    it("an empty workspace view lists nothing and says nothing was cut", async () => {
      const result = await call(
        listProjects,
        { view: "archive", search: "nothing has this text" },
        caller,
      );
      expect(result).toMatchObject({
        projects: [],
        total: 0,
        truncated: false,
      });
    });

    it("an empty search returns an empty typed list", async () => {
      const result = await call(
        searchWorkspace,
        { text: "no such phrase anywhere" },
        caller,
      );
      expect(result.results).toEqual([]);
    });
  },
);

describe.each(AGENT_CALLERS)(
  "other phrasings and languages for caller %s",
  (caller) => {
    it.each([
      ["Spanish", "Análisis de ingresos"],
      ["Japanese", "売上ダッシュボード"],
      ["accented capitals", "ÑANDÚ ÉXITO"],
    ])("a %s title is stored and read back unchanged", async (_l, title) => {
      const created = await call(createProject, { title }, caller);
      const read = await call(getProject, { projectId: created.id }, caller);
      expect(read.project.title).toBe(title);
    });

    it("a Japanese search finds the Japanese project", async () => {
      await makeProject("四半期の売上レポート");
      const listed = await call(listProjects, { search: "売上" }, caller);
      expect(
        listed.projects.map((row: { title: string }) => row.title),
      ).toContain("四半期の売上レポート");
      const searched = await call(searchWorkspace, { text: "売上" }, caller);
      expect(
        searched.results.map((row: { title: string }) => row.title),
      ).toContain("四半期の売上レポート");
    });

    it("a search without accents or capitals finds the accented title", async () => {
      await makeProject("Previsión de Ventas");
      const listed = await call(listProjects, { search: "PREVISION" }, caller);
      expect(
        listed.projects.map((row: { title: string }) => row.title),
      ).toContain("Previsión de Ventas");
    });

    it("a decomposed accent in the search matches the composed title", async () => {
      await makeProject("Café metrics");
      const decomposed = "Cafe\u0301";
      const listed = await call(listProjects, { search: decomposed }, caller);
      expect(
        listed.projects.map((row: { title: string }) => row.title),
      ).toContain("Café metrics");
    });

    it("a full-width Japanese title of 500 characters is accepted", async () => {
      const title = "売".repeat(500);
      const created = await call(createProject, { title }, caller);
      const read = await call(getProject, { projectId: created.id }, caller);
      expect(read.project.title).toBe(title);
    });
  },
);

describe.each(AGENT_CALLERS)("large inputs for caller %s", (caller) => {
  it("a long search text is refused before any read", async () => {
    expect(
      (await actionCallIntent(listProjects, { search: "x".repeat(201) })).valid,
    ).toBe(false);
    expect(
      (await actionCallIntent(searchWorkspace, { text: "x".repeat(501) }))
        .valid,
    ).toBe(false);
  });

  it("a listing is bounded for agents and says when rows were cut", async () => {
    for (let index = 0; index < 4; index += 1)
      await makeProject(`Bounded ${caller} listing ${index}`);
    const cut = await call(
      listProjects,
      { search: `bounded ${caller} listing`, limit: 3 },
      caller,
    );
    expect(cut.projects).toHaveLength(3);
    expect(cut).toMatchObject({ total: 4, truncated: true });
    const all = await call(
      listProjects,
      { search: `bounded ${caller} listing`, limit: 10 },
      caller,
    );
    expect(all).toMatchObject({ total: 4, truncated: false });
  });

  it("an unbounded limit is refused", async () => {
    expect((await actionCallIntent(listProjects, { limit: 501 })).valid).toBe(
      false,
    );
    expect((await actionCallIntent(listProjects, { limit: 0 })).valid).toBe(
      false,
    );
  });
});

describe("the default bound on an agent's listing", () => {
  const tag = "default bound row";

  beforeAll(async () => {
    for (let index = 0; index < AGENT_PROJECT_LIST_LIMIT + 1; index += 1)
      await makeProject(`${tag} ${index}`);
  });

  it.each(AGENT_CALLERS)(
    "caller %s gets one bounded page and a truncated flag",
    async (caller) => {
      const result = await call(listProjects, { search: tag }, caller);
      expect(result.projects).toHaveLength(AGENT_PROJECT_LIST_LIMIT);
      expect(result).toMatchObject({
        total: AGENT_PROJECT_LIST_LIMIT + 1,
        truncated: true,
      });
    },
  );

  it("the person's own listing is complete, with no implicit bound", async () => {
    const result = await call(listProjects, { search: tag }, "frontend");
    expect(result.projects).toHaveLength(AGENT_PROJECT_LIST_LIMIT + 1);
    expect(result.truncated).toBe(false);
  });
});
