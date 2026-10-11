import { describe, expect, it } from "vitest";

import type { DashboardSyncBase } from "../../../shared/dashboard-github-sync";
import {
  applyPullPlan,
  classifyDashboardSync,
  dashboardBase,
  dashboardFileContent,
  gitBlobSha,
  hashJson,
  parseDashboardFile,
  planPull,
  planPush,
  unitHashes,
  type DashboardDocument,
  type PullPlan,
  type SyncUnit,
} from "./plan";

const FILE = "dashboards/dash-1.json";
const BASE_SHA = "base-sha";
const REPO_SHA = "repo-sha";

/** The base a plan records. Fails when the plan records none, so the assertion is never skipped. */
function nextBaseOf(plan: PullPlan): DashboardSyncBase {
  if (plan.nextBase === null) throw new Error("expected a recorded base");
  return plan.nextBase;
}

/** A sql dashboard. Each panel is an [id, label] pair; the label is the panel title. */
function doc(
  panels: Array<[string, string]> = [],
  title = "Revenue",
): DashboardDocument {
  return {
    id: "dash-1",
    kind: "sql",
    config: {
      title,
      panels: panels.map(([id, label]) => ({ id, title: label })),
    },
  };
}

/** Panel "a" with the given label, or no panels when the label is null. */
function panelA(label: string | null): Array<[string, string]> {
  return label === null ? [] : [["a", label]];
}

function panelAHash(label: string | null): string | undefined {
  return label === null ? undefined : hashJson({ id: "a", title: label });
}

function panelIds(dashboard: DashboardDocument): string[] {
  return (dashboard.config.panels as Array<{ id: string }>).map(
    (panel) => panel.id,
  );
}

interface PanelRow {
  name: string;
  base: string | null;
  repo: string | null;
  db: string | null;
  changes: SyncUnit[];
  conflicts: SyncUnit[];
  ops: string[];
  order: string[] | null;
  nextA: "base" | "repo";
}

// Pull rules for panel "a". Each row is one cell of the per-unit decision table.
const PANEL_ROWS: PanelRow[] = [
  {
    name: "untouched",
    base: "v1",
    repo: "v1",
    db: "v1",
    changes: [],
    conflicts: [],
    ops: [],
    order: null,
    nextA: "base",
  },
  {
    name: "github edits",
    base: "v1",
    repo: "v2",
    db: "v1",
    changes: ["panel:a"],
    conflicts: [],
    ops: ["upsert:a"],
    order: null,
    nextA: "repo",
  },
  {
    name: "app edits",
    base: "v1",
    repo: "v1",
    db: "v3",
    changes: [],
    conflicts: [],
    ops: [],
    order: null,
    nextA: "base",
  },
  {
    name: "both edit the same way",
    base: "v1",
    repo: "v2",
    db: "v2",
    changes: [],
    conflicts: [],
    ops: [],
    order: null,
    nextA: "repo",
  },
  {
    name: "both edit differently",
    base: "v1",
    repo: "v2",
    db: "v3",
    changes: [],
    conflicts: ["panel:a"],
    ops: [],
    order: null,
    nextA: "base",
  },
  {
    name: "github adds",
    base: null,
    repo: "v2",
    db: null,
    changes: ["panel:a", "order"],
    conflicts: [],
    ops: ["upsert:a"],
    order: ["a"],
    nextA: "repo",
  },
  {
    name: "app adds",
    base: null,
    repo: null,
    db: "v3",
    changes: [],
    conflicts: [],
    ops: [],
    order: null,
    nextA: "base",
  },
  {
    name: "both add the same way",
    base: null,
    repo: "v2",
    db: "v2",
    changes: [],
    conflicts: [],
    ops: [],
    order: null,
    nextA: "repo",
  },
  {
    name: "both add differently",
    base: null,
    repo: "v2",
    db: "v3",
    changes: [],
    conflicts: ["panel:a"],
    ops: [],
    order: null,
    nextA: "base",
  },
  {
    name: "github removes",
    base: "v1",
    repo: null,
    db: "v1",
    changes: ["panel:a", "order"],
    conflicts: [],
    ops: ["delete:a"],
    order: [],
    nextA: "repo",
  },
  {
    name: "app removes",
    base: "v1",
    repo: "v1",
    db: null,
    changes: [],
    conflicts: [],
    ops: [],
    order: null,
    nextA: "base",
  },
  {
    name: "both remove",
    base: "v1",
    repo: null,
    db: null,
    changes: [],
    conflicts: [],
    ops: [],
    order: null,
    nextA: "repo",
  },
  {
    name: "github removes, app edits",
    base: "v1",
    repo: null,
    db: "v3",
    changes: ["order"],
    conflicts: ["panel:a"],
    ops: [],
    order: [],
    nextA: "base",
  },
  {
    name: "app removes, github edits",
    base: "v1",
    repo: "v2",
    db: null,
    changes: [],
    conflicts: ["panel:a"],
    ops: [],
    order: null,
    nextA: "base",
  },
];

describe("planPull panel units", () => {
  it.each(PANEL_ROWS)("$name", (row) => {
    const base = dashboardBase(doc(panelA(row.base)), FILE, BASE_SHA);
    const plan = planPull({
      base,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo: doc(panelA(row.repo)),
      db: doc(panelA(row.db)),
    });

    expect(plan.changes).toEqual(row.changes);
    expect(plan.conflicts).toEqual(row.conflicts);
    expect(plan.panelOps.map((op) => `${op.op}:${op.id}`)).toEqual(row.ops);
    expect(plan.order).toEqual(row.order);
    expect(nextBaseOf(plan).panels.a).toBe(
      row.nextA === "repo" ? panelAHash(row.repo) : base.panels.a,
    );
    expect(nextBaseOf(plan).filePath).toBe(FILE);
    expect(nextBaseOf(plan).fileSha).toBe(
      row.conflicts.length > 0 ? BASE_SHA : REPO_SHA,
    );
  });
});

interface MetaRow {
  name: string;
  base: string;
  repo: string;
  db: string;
  changes: SyncUnit[];
  conflicts: SyncUnit[];
  metaTitle: string | null;
  nextMeta: "base" | "repo";
}

const META_ROWS: MetaRow[] = [
  {
    name: "untouched",
    base: "Revenue",
    repo: "Revenue",
    db: "Revenue",
    changes: [],
    conflicts: [],
    metaTitle: null,
    nextMeta: "base",
  },
  {
    name: "github renames",
    base: "Revenue",
    repo: "Q3",
    db: "Revenue",
    changes: ["meta"],
    conflicts: [],
    metaTitle: "Q3",
    nextMeta: "repo",
  },
  {
    name: "app renames",
    base: "Revenue",
    repo: "Revenue",
    db: "Q2",
    changes: [],
    conflicts: [],
    metaTitle: null,
    nextMeta: "base",
  },
  {
    name: "both rename the same way",
    base: "Revenue",
    repo: "Q3",
    db: "Q3",
    changes: [],
    conflicts: [],
    metaTitle: null,
    nextMeta: "repo",
  },
  {
    name: "both rename differently",
    base: "Revenue",
    repo: "Q3",
    db: "Q2",
    changes: [],
    conflicts: ["meta"],
    metaTitle: null,
    nextMeta: "base",
  },
];

describe("planPull meta unit", () => {
  it.each(META_ROWS)("$name", (row) => {
    const base = dashboardBase(doc([], row.base), FILE, BASE_SHA);
    const plan = planPull({
      base,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo: doc([], row.repo),
      db: doc([], row.db),
    });

    expect(plan.changes).toEqual(row.changes);
    expect(plan.conflicts).toEqual(row.conflicts);
    expect(plan.meta).toEqual(
      row.metaTitle === null
        ? null
        : { kind: "sql", config: { title: row.metaTitle } },
    );
    expect(nextBaseOf(plan).meta).toBe(
      row.nextMeta === "repo" ? hashJson({ title: row.repo }) : base.meta,
    );
  });
});

interface OrderRow {
  name: string;
  base: string[];
  repo: string[];
  db: string[];
  changes: SyncUnit[];
  conflicts: SyncUnit[];
  order: string[] | null;
}

const ORDER_ROWS: OrderRow[] = [
  {
    name: "github reorders",
    base: ["a", "b"],
    repo: ["b", "a"],
    db: ["a", "b"],
    changes: ["order"],
    conflicts: [],
    order: ["b", "a"],
  },
  {
    name: "app reorders",
    base: ["a", "b"],
    repo: ["a", "b"],
    db: ["b", "a"],
    changes: [],
    conflicts: [],
    order: null,
  },
  {
    name: "both reorder the same way",
    base: ["a", "b"],
    repo: ["b", "a"],
    db: ["b", "a"],
    changes: [],
    conflicts: [],
    order: null,
  },
  {
    name: "both reorder differently",
    base: ["a", "b"],
    repo: ["b", "a"],
    db: ["a", "c", "b"],
    changes: [],
    conflicts: ["order"],
    order: null,
  },
];

function panelsWithIds(ids: string[]): DashboardDocument {
  return doc(ids.map((id): [string, string] => [id, "v1"]));
}

describe("planPull order unit", () => {
  it.each(ORDER_ROWS)("$name", (row) => {
    const plan = planPull({
      base: dashboardBase(panelsWithIds(row.base), FILE, BASE_SHA),
      filePath: FILE,
      repoSha: REPO_SHA,
      repo: panelsWithIds(row.repo),
      db: panelsWithIds(row.db),
    });

    expect(plan.changes).toEqual(row.changes);
    expect(plan.conflicts).toEqual(row.conflicts);
    expect(plan.order).toEqual(row.order);
  });
});

describe("planPull without a synced base or without a dashboard row", () => {
  it("creates a missing dashboard from every repo unit", () => {
    const repo = doc([["a", "v2"]], "Q3");
    const plan = planPull({
      base: null,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo,
      db: null,
    });

    expect(plan.changes).toEqual(["panel:a", "order", "meta"]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.panelOps).toEqual([
      { op: "upsert", id: "a", panel: { id: "a", title: "v2" } },
    ]);
    expect(plan.order).toEqual(["a"]);
    expect(plan.meta).toEqual({ kind: "sql", config: { title: "Q3" } });
    expect(plan.nextBase).toEqual(dashboardBase(repo, FILE, REPO_SHA));
  });

  it("recreates a deleted dashboard even when the file still matches base", () => {
    const repo = doc([["a", "v1"]]);
    const base = dashboardBase(repo, FILE, REPO_SHA);
    const plan = planPull({
      base,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo,
      db: null,
    });

    expect(plan.changes).toEqual(["panel:a", "order", "meta"]);
    expect(plan.nextBase).toEqual(dashboardBase(repo, FILE, REPO_SHA));
  });

  it("treats an identical never-synced dashboard as converged", () => {
    const repo = doc([["a", "v1"]]);
    const plan = planPull({
      base: null,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo,
      db: repo,
    });

    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.panelOps).toEqual([]);
    expect(plan.nextBase).toEqual(dashboardBase(repo, FILE, REPO_SHA));
  });

  it("conflicts a never-synced dashboard whose title differs, and does not advance fileSha", () => {
    const plan = planPull({
      base: null,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo: doc([["a", "v1"]], "Q3"),
      db: doc([["a", "v1"]], "Q2"),
    });

    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toEqual(["meta"]);
    // No base is recorded: a sentinel fileSha would fail the stored-state schema on read.
    expect(plan.nextBase).toBeNull();
  });

  it("keeps a panel id that names an Object.prototype key apart from a missing panel", () => {
    const plan = planPull({
      base: dashboardBase(doc(), FILE, BASE_SHA),
      filePath: FILE,
      repoSha: REPO_SHA,
      repo: doc([["constructor", "v2"]]),
      db: doc(),
    });

    expect(plan.changes).toEqual(["panel:constructor", "order"]);
    expect(plan.panelOps).toEqual([
      {
        op: "upsert",
        id: "constructor",
        panel: { id: "constructor", title: "v2" },
      },
    ]);
    expect(nextBaseOf(plan).panels.constructor).toBe(
      hashJson({ id: "constructor", title: "v2" }),
    );
  });
});

describe("gitBlobSha", () => {
  // Expected values come from `git hash-object --stdin`.
  it.each([
    {
      name: "a line of text",
      content: "hello\n",
      sha: "ce013625030ba8dba906f756967f9e9ca394464a",
    },
    {
      name: "the empty blob",
      content: "",
      sha: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    },
    {
      name: "non-ASCII text, hashed by its UTF-8 bytes",
      content: "héllo\n",
      sha: "5fb50d3c93474f139362304b663fe44e9d17a26e",
    },
  ])("matches git for $name", ({ content, sha }) => {
    expect(gitBlobSha(content)).toBe(sha);
  });
});

describe("hashJson", () => {
  it("hashes by content, not key order", () => {
    expect(hashJson({ a: 1, b: { c: 2, d: 3 } })).toBe(
      hashJson({ b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }));
  });
});

const VALID_PANEL = { id: "a", title: "v1" };

const MALFORMED = [
  { name: "invalid JSON", content: "{", message: /not valid JSON/ },
  { name: "a JSON array", content: "[]", message: /must be a JSON object/ },
  { name: "JSON null", content: "null", message: /must be a JSON object/ },
  {
    name: "a missing id",
    content: JSON.stringify({ kind: "sql", config: {} }),
    message: /id must be a non-empty string/,
  },
  {
    name: "a numeric id",
    content: JSON.stringify({ id: 1, kind: "sql", config: {} }),
    message: /id must be a non-empty string/,
  },
  {
    name: "an empty id",
    content: JSON.stringify({ id: "", kind: "sql", config: {} }),
    message: /id must be a non-empty string/,
  },
  {
    name: "an unknown kind",
    content: JSON.stringify({ id: "x", kind: "dashboard", config: {} }),
    message: /kind must be "sql" or "explorer"/,
  },
  {
    name: "a missing kind",
    content: JSON.stringify({ id: "x", config: {} }),
    message: /kind must be "sql" or "explorer"/,
  },
  {
    name: "a missing config",
    content: JSON.stringify({ id: "x", kind: "sql" }),
    message: /config must be an object/,
  },
  {
    name: "a config array",
    content: JSON.stringify({ id: "x", kind: "sql", config: [] }),
    message: /config must be an object/,
  },
  {
    name: "panels that are an object",
    content: JSON.stringify({ id: "x", kind: "sql", config: { panels: {} } }),
    message: /panels must be an array/,
  },
  {
    name: "panels set to null",
    content: JSON.stringify({ id: "x", kind: "sql", config: { panels: null } }),
    message: /panels must be an array/,
  },
  {
    name: "a null panel",
    content: JSON.stringify({
      id: "x",
      kind: "sql",
      config: { panels: [null] },
    }),
    message: /panel at index 0 must be an object with a non-empty string id/,
  },
  {
    name: "a panel without an id",
    content: JSON.stringify({
      id: "x",
      kind: "sql",
      config: { panels: [{ title: "v1" }] },
    }),
    message: /panel at index 0 must be an object/,
  },
  {
    name: "a panel with a numeric id",
    content: JSON.stringify({
      id: "x",
      kind: "sql",
      config: { panels: [{ id: 1 }] },
    }),
    message: /panel at index 0 must be an object/,
  },
  {
    name: "two panels with the same id",
    content: JSON.stringify({
      id: "x",
      kind: "sql",
      config: { panels: [VALID_PANEL, { id: "a", title: "v2" }] },
    }),
    message: /panel id "a" appears more than once/,
  },
];

describe("parseDashboardFile", () => {
  it.each(MALFORMED)("rejects $name", ({ content, message }) => {
    expect(() => parseDashboardFile(content)).toThrow(message);
  });

  it("accepts an explorer kind", () => {
    expect(
      parseDashboardFile(
        JSON.stringify({ id: "x", kind: "explorer", config: { panels: [] } }),
      ).kind,
    ).toBe("explorer");
  });

  // A missing `panels` key must fail, not read as zero panels: a typo'd key would otherwise pull as "delete every panel".
  it("rejects a repo config with no panels key", () => {
    expect(() =>
      parseDashboardFile(
        JSON.stringify({ id: "x", kind: "sql", config: { title: "t" } }),
      ),
    ).toThrow(/config\.panels must be an array/);
    expect(() =>
      parseDashboardFile(
        JSON.stringify({ id: "x", kind: "sql", config: { panel: [] } }),
      ),
    ).toThrow(/config\.panels must be an array/);
  });

  it("writes panels on every file so the round trip keeps the rule", () => {
    const content = dashboardFileContent({
      id: "x",
      kind: "sql",
      config: { title: "t" },
    });
    expect(parseDashboardFile(content).config.panels).toEqual([]);
  });
});

const SAMPLE: DashboardDocument = {
  id: "dash-1",
  kind: "sql",
  config: {
    title: "Revenue ✓",
    zeta: 1,
    filters: { region: ["us", "eu"], empty: null },
    panels: [
      { id: "b", title: "Signups", config: { y: 2, x: 1 } },
      { id: "a", title: "Churn", chartType: "bar" },
    ],
  },
};

describe("dashboard file content", () => {
  it("round-trips: parsing the file gives the same unit hashes", () => {
    const content = dashboardFileContent(SAMPLE);
    const parsed = parseDashboardFile(content);

    expect(unitHashes(parsed)).toEqual(unitHashes(SAMPLE));
    expect(dashboardFileContent(parsed)).toBe(content);
    expect(content.endsWith("}\n")).toBe(true);
  });

  it("writes the same bytes whatever key order the document was built with", () => {
    const reordered: DashboardDocument = {
      config: {
        panels: [
          { config: { x: 1, y: 2 }, title: "Signups", id: "b" },
          { id: "a", chartType: "bar", title: "Churn" },
        ],
        filters: { empty: null, region: ["us", "eu"] },
        zeta: 1,
        title: "Revenue ✓",
      },
      kind: "sql",
      id: "dash-1",
    };

    expect(dashboardFileContent(reordered)).toBe(dashboardFileContent(SAMPLE));
  });
});

describe("planPush", () => {
  const db = doc([
    ["a", "v1"],
    ["b", "v1"],
  ]);
  const base = dashboardBase(db, FILE, BASE_SHA);

  it("exports every unit when nothing was synced and GitHub has no file", () => {
    const plan = planPush({ base: null, filePath: FILE, repoSha: null, db });
    const content = dashboardFileContent(db);
    const blobSha = gitBlobSha(content);

    expect(plan).toEqual({
      status: "export",
      changes: ["panel:a", "panel:b", "order", "meta"],
      content,
      blobSha,
      base: dashboardBase(db, FILE, blobSha),
    });
  });

  const BLOCKED = [
    {
      name: "file deleted in GitHub",
      synced: true,
      repoSha: null,
      reason: "deleted in GitHub",
    },
    {
      name: "file exists but was never synced",
      synced: false,
      repoSha: REPO_SHA,
      reason: "exists in GitHub but is not synced; pull first",
    },
    {
      name: "file changed in GitHub",
      synced: true,
      repoSha: REPO_SHA,
      reason: "changed in GitHub; pull first",
    },
  ];

  it.each(BLOCKED)("blocks when $name", (row) => {
    expect(
      planPush({
        base: row.synced ? base : null,
        filePath: FILE,
        repoSha: row.repoSha,
        db,
      }),
    ).toEqual({ status: "blocked", reason: row.reason });
  });

  it("reports in-sync when nothing changed since base", () => {
    expect(planPush({ base, filePath: FILE, repoSha: BASE_SHA, db })).toEqual({
      status: "in-sync",
    });
  });

  const EXPORT_ROWS = [
    {
      name: "a title change",
      db: doc(
        [
          ["a", "v1"],
          ["b", "v1"],
        ],
        "Q2",
      ),
      changes: ["meta"],
    },
    {
      name: "a panel edit",
      db: doc([
        ["a", "v2"],
        ["b", "v1"],
      ]),
      changes: ["panel:a"],
    },
    {
      name: "a panel removed",
      db: doc([["b", "v1"]]),
      changes: ["panel:a", "order"],
    },
    {
      name: "a panel added",
      db: doc([
        ["a", "v1"],
        ["b", "v1"],
        ["c", "v1"],
      ]),
      changes: ["panel:c", "order"],
    },
    {
      name: "a reorder",
      db: doc([
        ["b", "v1"],
        ["a", "v1"],
      ]),
      changes: ["order"],
    },
    {
      name: "a panel edit and a title change",
      db: doc(
        [
          ["a", "v2"],
          ["b", "v1"],
        ],
        "Q2",
      ),
      changes: ["panel:a", "meta"],
    },
  ];

  it.each(EXPORT_ROWS)("exports only the changed units for $name", (row) => {
    const plan = planPush({
      base,
      filePath: FILE,
      repoSha: BASE_SHA,
      db: row.db,
    });
    const content = dashboardFileContent(row.db);
    const blobSha = gitBlobSha(content);

    expect(plan).toEqual({
      status: "export",
      changes: row.changes,
      content,
      blobSha,
      base: dashboardBase(row.db, FILE, blobSha),
    });
  });
});

interface ClassifyRow {
  name: string;
  base: boolean;
  repoSha: string | null;
  repo: DashboardDocument | null;
  db: DashboardDocument | null;
  status: string;
  pull: SyncUnit[];
  conflicts: SyncUnit[];
  exported: SyncUnit[];
}

const SYNCED = dashboardBase(doc([["a", "v1"]]), FILE, BASE_SHA);

const CLASSIFY_ROWS: ClassifyRow[] = [
  {
    name: "in-sync",
    base: true,
    repoSha: BASE_SHA,
    repo: null,
    db: doc([["a", "v1"]]),
    status: "in-sync",
    pull: [],
    conflicts: [],
    exported: [],
  },
  {
    name: "app edited a panel",
    base: true,
    repoSha: BASE_SHA,
    repo: null,
    db: doc([["a", "v2"]]),
    status: "app-changed",
    pull: [],
    conflicts: [],
    exported: ["panel:a"],
  },
  {
    name: "github renamed",
    base: true,
    repoSha: REPO_SHA,
    repo: doc([["a", "v1"]], "Q3"),
    db: doc([["a", "v1"]]),
    status: "github-changed",
    pull: ["meta"],
    conflicts: [],
    exported: [],
  },
  {
    name: "github renamed and app edited a panel",
    base: true,
    repoSha: REPO_SHA,
    repo: doc([["a", "v1"]], "Q3"),
    db: doc([["a", "v2"]]),
    status: "both-changed",
    pull: ["meta"],
    conflicts: [],
    exported: ["panel:a"],
  },
  {
    name: "both edited the same panel",
    base: true,
    repoSha: REPO_SHA,
    repo: doc([["a", "v2"]]),
    db: doc([["a", "v3"]]),
    status: "conflict",
    pull: [],
    conflicts: ["panel:a"],
    exported: ["panel:a"],
  },
  {
    name: "a conflict beside a github rename",
    base: true,
    repoSha: REPO_SHA,
    repo: doc([["a", "v2"]], "Q3"),
    db: doc([["a", "v3"]]),
    status: "conflict",
    pull: ["meta"],
    conflicts: ["panel:a"],
    exported: ["panel:a"],
  },
  {
    name: "removed in GitHub",
    base: true,
    repoSha: null,
    repo: null,
    db: doc([["a", "v1"]], "Q2"),
    status: "removed-in-github",
    pull: [],
    conflicts: [],
    exported: ["meta"],
  },
  {
    name: "never exported",
    base: false,
    repoSha: null,
    repo: null,
    db: doc([["a", "v1"]]),
    status: "not-exported",
    pull: [],
    conflicts: [],
    exported: ["panel:a", "order", "meta"],
  },
  {
    name: "new in GitHub",
    base: false,
    repoSha: REPO_SHA,
    repo: doc([["a", "v1"]]),
    db: null,
    status: "new-in-github",
    pull: ["panel:a", "order", "meta"],
    conflicts: [],
    exported: [],
  },
  {
    name: "row deleted while the file is unchanged",
    base: true,
    repoSha: BASE_SHA,
    repo: doc([["a", "v1"]]),
    db: null,
    status: "new-in-github",
    pull: ["panel:a", "order", "meta"],
    conflicts: [],
    exported: [],
  },
];

describe("classifyDashboardSync", () => {
  it.each(CLASSIFY_ROWS)("$name", (row) => {
    const result = classifyDashboardSync({
      base: row.base ? SYNCED : null,
      filePath: FILE,
      repoSha: row.repoSha,
      repo: row.repo,
      db: row.db,
    });

    expect(result).toEqual({
      status: row.status,
      pullChanges: row.pull,
      conflicts: row.conflicts,
      exportChanges: row.exported,
    });
  });

  it("throws when there is neither a row nor a file", () => {
    expect(() =>
      classifyDashboardSync({
        base: null,
        filePath: FILE,
        repoSha: null,
        repo: null,
        db: null,
      }),
    ).toThrow(/nothing to classify/);
  });

  it("throws when a changed file has no parsed repo document", () => {
    expect(() =>
      classifyDashboardSync({
        base: SYNCED,
        filePath: FILE,
        repoSha: REPO_SHA,
        repo: null,
        db: doc(),
      }),
    ).toThrow(/parsed repo document/);
  });

  it("throws for a file with no row when its repo document is missing", () => {
    expect(() =>
      classifyDashboardSync({
        base: null,
        filePath: FILE,
        repoSha: REPO_SHA,
        repo: null,
        db: null,
      }),
    ).toThrow(/parsed repo document/);
  });
});

describe("applyPullPlan", () => {
  it("creates the dashboard from the repo when there is no row", () => {
    const repo = doc([["a", "v2"]], "Q3");
    const plan = planPull({
      base: null,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo,
      db: null,
    });

    expect(applyPullPlan(null, repo, plan)).toEqual(repo);
  });

  it("deletes a panel the repo removed and keeps the app's edit to another panel", () => {
    const base = dashboardBase(
      doc([
        ["a", "v1"],
        ["b", "v1"],
      ]),
      FILE,
      BASE_SHA,
    );
    const db = doc([
      ["a", "v1"],
      ["b", "v3"],
    ]);
    const repo = doc([["b", "v1"]]);
    const plan = planPull({
      base,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo,
      db,
    });
    const before = structuredClone(db);

    const result = applyPullPlan(db, repo, plan);

    expect(result.config.panels).toEqual([{ id: "b", title: "v3" }]);
    expect(db).toEqual(before);
  });

  it("adopts the repo's panel order", () => {
    const base = dashboardBase(
      doc([
        ["a", "v1"],
        ["b", "v1"],
      ]),
      FILE,
      BASE_SHA,
    );
    const db = doc([
      ["a", "v1"],
      ["b", "v1"],
    ]);
    const repo = doc([
      ["b", "v1"],
      ["a", "v1"],
    ]);
    const plan = planPull({
      base,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo,
      db,
    });

    expect(panelIds(applyPullPlan(db, repo, plan))).toEqual(["b", "a"]);
  });

  it("puts ids missing from the order after the ordered ones, in their relative order", () => {
    const db = doc([
      ["a", "v1"],
      ["b", "v1"],
      ["c", "v1"],
    ]);
    const plan: PullPlan = {
      changes: ["order"],
      conflicts: [],
      panelOps: [],
      order: ["c"],
      meta: null,
      nextBase: dashboardBase(db, FILE, REPO_SHA),
    };

    expect(panelIds(applyPullPlan(db, db, plan))).toEqual(["c", "a", "b"]);
  });

  it("replaces the config from the repo and keeps the app's panels", () => {
    const base = dashboardBase(doc([["a", "v1"]]), FILE, BASE_SHA);
    const db = doc([["a", "v1"]]);
    const repo = doc([["a", "v1"]], "Q3");
    const plan = planPull({
      base,
      filePath: FILE,
      repoSha: REPO_SHA,
      repo,
      db,
    });

    expect(plan.changes).toEqual(["meta"]);
    expect(applyPullPlan(db, repo, plan)).toEqual(doc([["a", "v1"]], "Q3"));
  });
});
