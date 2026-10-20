import * as serverCore from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as updateDashboard from "../../../actions/update-dashboard";
import type {
  DashboardSyncBase,
  FolderGitHubSyncConfig,
  FolderPendingExport,
  GitHubFolderLink,
  PendingDashboardExport,
} from "../../../shared/dashboard-github-sync";
import * as credentials from "../credentials-context";
import * as folders from "../dashboard-folders-store";
import * as dashboards from "../dashboards-store";
import type { DashboardRecord } from "../dashboards-store";
import {
  applyFolderSync,
  configureFolderSync,
  exportFolderSync,
  previewFolderSync,
  type SyncCaller,
  syncCallerFromRequest,
} from "./folder-sync";
import * as github from "./github";
import {
  type DashboardDocument,
  dashboardBase,
  dashboardFileContent,
  gitBlobSha,
  hashJson,
} from "./plan";
import * as syncState from "./state";

vi.mock("@agent-native/core/action", () => ({
  fail: (
    message: string,
    options: { errorCode?: string; statusCode?: number } = {},
  ) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));
vi.mock("../credentials-context", () => ({
  requireRequestCredentialContext: vi.fn(),
}));
vi.mock("../dashboard-agent-write", () => ({
  requireEditableDashboard: vi.fn(async () => undefined),
}));
vi.mock("../dashboard-collab-sync", () => ({
  queueDashboardCollabSync: vi.fn(),
}));
vi.mock("../dashboard-folders-store", () => ({
  assignDashboardToFolder: vi.fn(),
}));
vi.mock("../dashboards-store", () => ({
  getDashboard: vi.fn(),
  upsertDashboard: vi.fn(),
  upsertDashboardWithRetryOutcome: vi.fn(),
}));
vi.mock("../../../actions/update-dashboard", () => ({
  assertValidDashboardConfig: vi.fn(),
  validatePanelSql: vi.fn(),
}));
vi.mock("./github", () => ({
  listGitHubFolderFiles: vi.fn(),
  readGitHubFile: vi.fn(),
  getGitHubPullRequestState: vi.fn(),
  createGitHubExportPullRequest: vi.fn(),
  assertGitHubBranch: vi.fn(),
}));
vi.mock("./state", () => ({
  readFolderSyncConfig: vi.fn(),
  writeFolderSyncConfig: vi.fn(),
  readDashboardSyncBase: vi.fn(),
  writeDashboardSyncBase: vi.fn(),
  listFolderSqlDashboards: vi.fn(),
  readDashboardFolderId: vi.fn(),
}));

const FOLDER = "folder-1";
const ACCESS = { email: "alice@example.com", orgId: null };
const LINK: GitHubFolderLink = {
  owner: "acme",
  repo: "dash",
  branch: "main",
  path: "dashboards",
};
const PR_URL = "https://github.com/acme/dash/pull/7";
const PR_CLOSE_MESSAGE =
  "Export PR #7 is still open. Merge or close it before syncing or changing this folder's GitHub link.";

type PrState = "open" | "merged" | "closed";
type Panels = Array<[id: string, label: string]>;

/** Everything the fake GitHub and fake database hold. Reset before each test. */
interface FakeState {
  folder: FolderGitHubSyncConfig | null;
  /** Every dashboard row, in or out of the folder. */
  rows: Map<string, DashboardRecord>;
  folderIds: Set<string>;
  /** A dashboard id missing here is a fixture bug, so reads of it throw. */
  bases: Map<string, DashboardSyncBase | null>;
  /** Repo path -> file content. The blob sha is derived, never stored. */
  repoFiles: Map<string, string>;
  prState: PrState;
}

let fake: FakeState;
let caller: SyncCaller;

interface RepoFile {
  path: string;
  content: string;
}

interface SeedRow {
  doc: DashboardDocument;
  canEdit?: boolean;
  /** Defaults to null: the dashboard has never been synced. */
  base?: DashboardSyncBase | null;
}

interface Seed {
  folder?: FolderGitHubSyncConfig | null;
  dashboards?: SeedRow[];
  files?: RepoFile[];
  prState?: PrState;
}

/** A sql dashboard document. Each panel is an [id, label] pair; the label is the panel title. */
function doc(
  id: string,
  panels: Panels = [["a", "v1"]],
  title = "Revenue",
  kind: DashboardDocument["kind"] = "sql",
): DashboardDocument {
  return {
    id,
    kind,
    config: {
      title,
      panels: panels.map(([panelId, label]) => ({ id: panelId, title: label })),
    },
  };
}

function titleOf(config: Record<string, unknown>): string {
  if (typeof config.title !== "string") {
    throw new Error("fixture config has no string title");
  }
  return config.title;
}

function rowOf(dashboard: DashboardDocument, canEdit = true): DashboardRecord {
  return {
    id: dashboard.id,
    kind: dashboard.kind,
    title: titleOf(dashboard.config),
    config: dashboard.config,
    ownerEmail: ACCESS.email,
    orgId: null,
    visibility: "private",
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: ACCESS.email,
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: ACCESS.email,
    archivedAt: null,
    hiddenAt: null,
    hiddenBy: null,
    canEdit,
  };
}

/** The file GitHub holds when the dashboard is exactly this document. */
function repoFile(dashboard: DashboardDocument): RepoFile {
  return {
    path: `dashboards/${dashboard.id}.json`,
    content: dashboardFileContent(dashboard),
  };
}

function baseOf(dashboard: DashboardDocument): DashboardSyncBase {
  const file = repoFile(dashboard);
  return dashboardBase(dashboard, file.path, gitBlobSha(file.content));
}

function pendingFor(dashboard: DashboardDocument): PendingDashboardExport {
  return {
    blobSha: gitBlobSha(repoFile(dashboard).content),
    base: baseOf(dashboard),
  };
}

function folderConfig(
  pendingExport: FolderPendingExport | null = null,
): FolderGitHubSyncConfig {
  return { link: LINK, pendingExport };
}

function openExport(
  prNumber: number,
  dashboards: DashboardDocument[],
): FolderPendingExport {
  return {
    branch: "dashboard-sync/folder-1-20261009120000",
    prNumber,
    prUrl: `https://github.com/acme/dash/pull/${prNumber}`,
    dashboards: Object.fromEntries(
      dashboards.map((dashboard) => [dashboard.id, pendingFor(dashboard)]),
    ),
  };
}

function seed(input: Seed) {
  if (input.folder !== undefined) fake.folder = input.folder;
  for (const {
    doc: dashboard,
    canEdit = true,
    base = null,
  } of input.dashboards ?? []) {
    fake.rows.set(dashboard.id, rowOf(dashboard, canEdit));
    fake.folderIds.add(dashboard.id);
    fake.bases.set(dashboard.id, base);
  }
  for (const file of input.files ?? []) {
    fake.repoFiles.set(file.path, file.content);
  }
  if (input.prState !== undefined) fake.prState = input.prState;
}

function rowNamed(id: string): DashboardRecord {
  const row = fake.rows.get(id);
  if (!row) throw new Error(`fake store has no dashboard ${id}`);
  return row;
}

/** Resolves to the error a call rejects with. Fails when the call succeeds. */
async function failureOf(call: Promise<unknown>): Promise<Error> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = {
    folder: folderConfig(),
    rows: new Map(),
    folderIds: new Set(),
    bases: new Map(),
    repoFiles: new Map(),
    prState: "open",
  };

  vi.mocked(serverCore.getRequestUserEmail).mockReturnValue(ACCESS.email);
  vi.mocked(serverCore.getRequestOrgId).mockReturnValue(undefined);
  vi.mocked(credentials.requireRequestCredentialContext).mockReturnValue({
    userEmail: ACCESS.email,
    orgId: null,
  });
  vi.mocked(updateDashboard.validatePanelSql).mockResolvedValue(null);
  caller = syncCallerFromRequest();

  vi.mocked(github.listGitHubFolderFiles).mockImplementation(async () =>
    [...fake.repoFiles].map(([path, content]) => ({
      path,
      sha: gitBlobSha(content),
    })),
  );
  vi.mocked(github.readGitHubFile).mockImplementation(
    async (_ctx, _link, path) => {
      const content = fake.repoFiles.get(path);
      if (content === undefined)
        throw new Error(`fake GitHub has no file ${path}`);
      return { sha: gitBlobSha(content), content };
    },
  );
  vi.mocked(github.getGitHubPullRequestState).mockImplementation(
    async () => fake.prState,
  );
  vi.mocked(github.createGitHubExportPullRequest).mockImplementation(
    async (_ctx, input) => ({
      prNumber: 42,
      prUrl: "https://github.com/acme/dash/pull/42",
      blobShas: Object.fromEntries(
        input.files.map((file) => [file.path, gitBlobSha(file.content)]),
      ),
    }),
  );
  vi.mocked(github.assertGitHubBranch).mockResolvedValue(undefined);

  vi.mocked(syncState.readFolderSyncConfig).mockImplementation(
    async () => fake.folder,
  );
  vi.mocked(syncState.writeFolderSyncConfig).mockImplementation(
    async (_folderId, _ctx, config) => {
      fake.folder = config;
    },
  );
  vi.mocked(syncState.readDashboardSyncBase).mockImplementation(async (id) => {
    const base = fake.bases.get(id);
    if (base === undefined)
      throw new Error(`fixture has no base entry for ${id}`);
    return base;
  });
  vi.mocked(syncState.writeDashboardSyncBase).mockImplementation(
    async (id, _ctx, base) => {
      // Mirrors the real write: a missing or unauthorized dashboard fails.
      if (!fake.rows.has(id)) throw new Error(`No access to dashboard ${id}`);
      fake.bases.set(id, base);
    },
  );
  vi.mocked(syncState.listFolderSqlDashboards).mockImplementation(async () =>
    [...fake.rows.values()].filter(
      (row) => fake.folderIds.has(row.id) && row.kind === "sql",
    ),
  );

  vi.mocked(syncState.readDashboardFolderId).mockImplementation(async (id) =>
    fake.folderIds.has(id) ? FOLDER : null,
  );
  vi.mocked(dashboards.getDashboard).mockImplementation(
    async (id) => fake.rows.get(id) ?? null,
  );
  vi.mocked(dashboards.upsertDashboard).mockImplementation(
    async (id, kind, body) => {
      const record = rowOf({ id, kind, config: body });
      fake.rows.set(id, record);
      return record;
    },
  );
  vi.mocked(dashboards.upsertDashboardWithRetryOutcome).mockImplementation(
    async (id, _ctx, mutate) => {
      const existing = fake.rows.get(id);
      if (!existing) throw new Error(`fake store has no dashboard ${id}`);
      const next = await mutate(existing);
      const dashboard = {
        ...existing,
        kind: next.kind,
        config: next.body,
        title: titleOf(next.body),
      };
      fake.rows.set(id, dashboard);
      return { dashboard, didWrite: true };
    },
  );
  vi.mocked(folders.assignDashboardToFolder).mockImplementation(async (id) => {
    const row = rowNamed(id);
    fake.folderIds.add(id);
    return row;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("previewFolderSync", () => {
  it("returns no link and no dashboards for an unlinked folder, without touching GitHub", async () => {
    seed({ folder: null });

    await expect(previewFolderSync(FOLDER, caller)).resolves.toEqual({
      folderId: FOLDER,
      link: null,
      pendingExport: null,
      dashboards: [],
    });
    expect(github.listGitHubFolderFiles).not.toHaveBeenCalled();
    expect(github.readGitHubFile).not.toHaveBeenCalled();
  });

  it("reports a dashboard whose file matches its base as in-sync without reading the file", async () => {
    const d1 = doc("d1");
    seed({
      dashboards: [{ doc: d1, base: baseOf(d1) }],
      files: [repoFile(d1)],
    });

    const preview = await previewFolderSync(FOLDER, caller);

    expect(preview.dashboards).toMatchObject([
      {
        dashboardId: "d1",
        status: "in-sync",
        pullChanges: [],
        exportChanges: [],
      },
    ]);
    expect(github.readGitHubFile).not.toHaveBeenCalled();
  });

  it("marks a panel changed only in GitHub as github-changed with panel:<id> to pull", async () => {
    const before = doc("d1", [["a", "v1"]]);
    const inGitHub = doc("d1", [["a", "v2"]]);
    seed({
      dashboards: [{ doc: before, base: baseOf(before) }],
      files: [repoFile(inGitHub)],
    });

    const preview = await previewFolderSync(FOLDER, caller);

    expect(preview.dashboards).toMatchObject([
      {
        dashboardId: "d1",
        status: "github-changed",
        pullChanges: ["panel:a"],
        conflicts: [],
        exportChanges: [],
      },
    ]);
  });

  it("marks dashboards in an open export PR export-pending and reports the PR as open", async () => {
    const exported = doc("d1", [["a", "v2"]]);
    seed({
      folder: folderConfig(openExport(7, [exported])),
      dashboards: [{ doc: exported }],
      prState: "open",
    });

    const preview = await previewFolderSync(FOLDER, caller);

    expect(preview.pendingExport).toEqual({
      prNumber: 7,
      prUrl: PR_URL,
      state: "open",
    });
    expect(preview.dashboards).toMatchObject([
      { dashboardId: "d1", status: "export-pending" },
    ]);
  });

  it("marks a dashboard with no file and no base as not-exported", async () => {
    seed({ dashboards: [{ doc: doc("d1") }] });

    const preview = await previewFolderSync(FOLDER, caller);

    expect(preview.dashboards).toMatchObject([
      {
        dashboardId: "d1",
        status: "not-exported",
        pullChanges: [],
        exportChanges: ["panel:a", "order", "meta"],
      },
    ]);
    expect(github.readGitHubFile).not.toHaveBeenCalled();
  });

  it("marks a file with no dashboard row and no existing dashboard as new-in-github", async () => {
    seed({ files: [repoFile(doc("d9", [["a", "v1"]], "Q3"))] });

    const preview = await previewFolderSync(FOLDER, caller);

    expect(preview.dashboards).toMatchObject([
      {
        dashboardId: "d9",
        title: "Q3",
        status: "new-in-github",
        filePath: "dashboards/d9.json",
        pullChanges: ["panel:a", "order", "meta"],
        exportChanges: [],
      },
    ]);
  });

  it("fails naming both ids when a file's contained id differs from its file name", async () => {
    seed({
      dashboards: [{ doc: doc("d1") }],
      files: [
        {
          path: "dashboards/d1.json",
          content: dashboardFileContent(doc("d2")),
        },
      ],
    });

    const error = await failureOf(previewFolderSync(FOLDER, caller));

    expect(error.message).toBe(
      'dashboards/d1.json contains dashboard "d2", but its file name is "d1".',
    );
    expect(error).toMatchObject({
      errorCode: "github_sync_id_mismatch",
      statusCode: 422,
    });
  });

  it("fails loudly when a file's kind is explorer", async () => {
    seed({
      dashboards: [{ doc: doc("d1") }],
      files: [repoFile(doc("d1", [["a", "v1"]], "Revenue", "explorer"))],
    });

    const error = await failureOf(previewFolderSync(FOLDER, caller));

    expect(error.message).toBe(
      'dashboards/d1.json is a "explorer" dashboard. Only SQL dashboards sync with GitHub.',
    );
    expect(error).toMatchObject({
      errorCode: "github_sync_unsupported_kind",
      statusCode: 422,
    });
  });
});

describe("applyFolderSync", () => {
  it("throws 409 naming the PR and writes nothing while an export PR is open", async () => {
    const d1 = doc("d1", [["a", "v2"]]);
    seed({
      folder: folderConfig(openExport(7, [d1])),
      dashboards: [{ doc: d1, base: baseOf(doc("d1")) }],
      prState: "open",
    });

    const error = await failureOf(applyFolderSync(FOLDER, caller));

    expect(error.message).toBe(PR_CLOSE_MESSAGE);
    expect(error).toMatchObject({
      errorCode: "github_sync_export_pending",
      statusCode: 409,
    });
    expect(github.listGitHubFolderFiles).not.toHaveBeenCalled();
    expect(syncState.writeFolderSyncConfig).not.toHaveBeenCalled();
    expect(syncState.writeDashboardSyncBase).not.toHaveBeenCalled();
    expect(dashboards.upsertDashboardWithRetryOutcome).not.toHaveBeenCalled();
  });

  it("finalizes a merged export by writing each pending base and clearing pendingExport", async () => {
    const exported = doc("d1", [["a", "v2"]]);
    seed({
      folder: folderConfig(openExport(7, [exported])),
      dashboards: [{ doc: exported }],
      files: [repoFile(exported)],
      prState: "merged",
    });

    const result = await applyFolderSync(FOLDER, caller);

    expect(result).toEqual({
      folderId: FOLDER,
      finalizedExport: "merged",
      applied: [],
      skipped: [],
    });
    expect(syncState.writeDashboardSyncBase).toHaveBeenCalledWith(
      "d1",
      ACCESS,
      baseOf(exported),
    );
    expect(syncState.writeFolderSyncConfig).toHaveBeenCalledWith(
      FOLDER,
      ACCESS,
      { link: LINK, pendingExport: null },
    );
  });

  it("clears pendingExport for a merged export even when its dashboard was deleted", async () => {
    const deleted = doc("d1", [["a", "v2"]]);
    seed({
      folder: folderConfig(openExport(7, [deleted])),
      prState: "merged",
    });

    const result = await applyFolderSync(FOLDER, caller);

    expect(result).toMatchObject({ finalizedExport: "merged" });
    expect(syncState.writeFolderSyncConfig).toHaveBeenCalledWith(
      FOLDER,
      ACCESS,
      { link: LINK, pendingExport: null },
    );
  });

  it("clears pendingExport for a closed export and writes no bases", async () => {
    const pendingDoc = doc("d1", [["a", "v2"]]);
    const onGitHub = doc("d1");
    seed({
      folder: folderConfig(openExport(7, [pendingDoc])),
      dashboards: [{ doc: pendingDoc, base: baseOf(onGitHub) }],
      files: [repoFile(onGitHub)],
      prState: "closed",
    });

    const result = await applyFolderSync(FOLDER, caller);

    expect(result).toEqual({
      folderId: FOLDER,
      finalizedExport: "closed",
      applied: [],
      skipped: [],
    });
    expect(syncState.writeDashboardSyncBase).not.toHaveBeenCalled();
    expect(syncState.writeFolderSyncConfig).toHaveBeenCalledWith(
      FOLDER,
      ACCESS,
      { link: LINK, pendingExport: null },
    );
  });

  it("applies a GitHub-only panel, keeps an app-only panel, and reports a both-changed panel as a conflict", async () => {
    const base = doc("d1", [
      ["a", "v1"],
      ["b", "v1"],
      ["c", "v1"],
    ]);
    const inGitHub = doc("d1", [
      ["a", "v2"],
      ["b", "v1"],
      ["c", "v3"],
    ]);
    const inApp = doc("d1", [
      ["a", "v1"],
      ["b", "v4"],
      ["c", "v5"],
    ]);
    seed({
      dashboards: [{ doc: inApp, base: baseOf(base) }],
      files: [repoFile(inGitHub)],
    });

    const result = await applyFolderSync(FOLDER, caller);

    expect(result).toEqual({
      folderId: FOLDER,
      finalizedExport: null,
      applied: [
        {
          dashboardId: "d1",
          title: "Revenue",
          created: false,
          changes: ["panel:a"],
          conflicts: ["panel:c"],
        },
      ],
      skipped: [],
    });
    expect(rowNamed("d1").config).toEqual(
      doc("d1", [
        ["a", "v2"],
        ["b", "v4"],
        ["c", "v5"],
      ]).config,
    );
    // Only panel a advances. The conflicting panel c keeps its old base, and
    // fileSha stays put so the next run still sees the conflict.
    expect(syncState.writeDashboardSyncBase).toHaveBeenCalledWith(
      "d1",
      ACCESS,
      {
        ...baseOf(base),
        panels: {
          ...baseOf(base).panels,
          a: hashJson({ id: "a", title: "v2" }),
        },
      },
    );
  });

  it("creates a dashboard for a file with no row, in the folder, with the planner's base recorded", async () => {
    const d9 = doc("d9", [["a", "v2"]], "Q3");
    seed({ files: [repoFile(d9)] });

    const result = await applyFolderSync(FOLDER, caller);

    expect(result).toEqual({
      folderId: FOLDER,
      finalizedExport: null,
      applied: [
        {
          dashboardId: "d9",
          title: "Q3",
          created: true,
          changes: ["panel:a", "order", "meta"],
          conflicts: [],
        },
      ],
      skipped: [],
    });
    expect(rowNamed("d9").config).toEqual(d9.config);
    expect(folders.assignDashboardToFolder).toHaveBeenCalledWith(
      "d9",
      FOLDER,
      ACCESS,
    );
    expect(syncState.writeDashboardSyncBase).toHaveBeenCalledWith(
      "d9",
      ACCESS,
      baseOf(d9),
    );
  });

  it("skips a dashboard the caller cannot edit with reason 'no edit access'", async () => {
    const d1 = doc("d1");
    seed({
      dashboards: [{ doc: d1, canEdit: false, base: baseOf(d1) }],
      files: [repoFile(doc("d1", [["a", "v2"]]))],
    });

    const result = await applyFolderSync(FOLDER, caller);

    expect(result).toEqual({
      folderId: FOLDER,
      finalizedExport: null,
      applied: [],
      skipped: [{ dashboardId: "d1", reason: "no edit access" }],
    });
    expect(dashboards.upsertDashboardWithRetryOutcome).not.toHaveBeenCalled();
    expect(syncState.writeDashboardSyncBase).not.toHaveBeenCalled();
  });

  it("finishes a create whose folder assignment failed on the next apply", async () => {
    const d9 = doc("d9", [["a", "v2"]], "Q3");
    seed({ files: [repoFile(d9)] });
    vi.mocked(folders.assignDashboardToFolder).mockRejectedValueOnce(
      new Error("folder write failed"),
    );

    await expect(applyFolderSync(FOLDER, caller)).rejects.toThrow(
      "folder write failed",
    );
    const retry = await applyFolderSync(FOLDER, caller);

    expect(retry.skipped).toEqual([]);
    expect(folders.assignDashboardToFolder).toHaveBeenLastCalledWith(
      "d9",
      FOLDER,
      ACCESS,
    );
  });
});

describe("exportFolderSync", () => {
  it("creates no PR and returns prNumber null when every dashboard is in sync", async () => {
    const d1 = doc("d1");
    seed({
      dashboards: [{ doc: d1, base: baseOf(d1) }],
      files: [repoFile(d1)],
    });

    await expect(exportFolderSync(FOLDER, caller)).resolves.toEqual({
      folderId: FOLDER,
      prNumber: null,
      prUrl: null,
      exported: [],
      skipped: [],
    });
    expect(github.createGitHubExportPullRequest).not.toHaveBeenCalled();
    expect(syncState.writeFolderSyncConfig).not.toHaveBeenCalled();
  });

  it("skips a dashboard whose GitHub file changed since base and still exports the others", async () => {
    const d1 = doc("d1");
    const d1InGitHub = doc("d1", [["a", "v9"]]);
    const d2 = doc("d2");
    const d2Edited = doc("d2", [["a", "v2"]]);
    seed({
      dashboards: [
        { doc: d1, base: baseOf(d1) },
        { doc: d2Edited, base: baseOf(d2) },
      ],
      files: [repoFile(d1InGitHub), repoFile(d2)],
    });

    const result = await exportFolderSync(FOLDER, caller);

    expect(result).toEqual({
      folderId: FOLDER,
      prNumber: 42,
      prUrl: "https://github.com/acme/dash/pull/42",
      exported: [{ dashboardId: "d2", changes: ["panel:a"] }],
      skipped: [{ dashboardId: "d1", reason: "changed in GitHub; pull first" }],
    });
    expect(github.createGitHubExportPullRequest).toHaveBeenCalledWith(
      caller.credential,
      expect.objectContaining({
        files: [repoFile(d2Edited)],
      }),
    );
  });

  it("opens one PR with a file per changed dashboard and records each blobSha and base as pending", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const d1Before = doc("d1");
    const d1Edited = doc("d1", [["a", "v2"]]);
    const d2Before = doc("d2");
    const d2Edited = doc("d2", [["a", "v3"]]);
    seed({
      dashboards: [
        { doc: d1Edited, base: baseOf(d1Before) },
        { doc: d2Edited, base: baseOf(d2Before) },
      ],
      files: [repoFile(d1Before), repoFile(d2Before)],
    });

    const result = await exportFolderSync(FOLDER, caller);

    expect(github.createGitHubExportPullRequest).toHaveBeenCalledTimes(1);
    expect(github.createGitHubExportPullRequest).toHaveBeenCalledWith(
      caller.credential,
      expect.objectContaining({
        link: LINK,
        branch: "dashboard-sync/folder-1-20261009120000",
        files: [repoFile(d1Edited), repoFile(d2Edited)],
      }),
    );
    expect(result).toMatchObject({
      prNumber: 42,
      prUrl: "https://github.com/acme/dash/pull/42",
      exported: [
        { dashboardId: "d1", changes: ["panel:a"] },
        { dashboardId: "d2", changes: ["panel:a"] },
      ],
    });
    expect(syncState.writeFolderSyncConfig).toHaveBeenCalledWith(
      FOLDER,
      ACCESS,
      {
        link: LINK,
        pendingExport: {
          branch: "dashboard-sync/folder-1-20261009120000",
          prNumber: 42,
          prUrl: "https://github.com/acme/dash/pull/42",
          dashboards: {
            d1: pendingFor(d1Edited),
            d2: pendingFor(d2Edited),
          },
        },
      },
    );
  });

  it("throws 409 when an export PR is still open", async () => {
    const d1 = doc("d1", [["a", "v2"]]);
    seed({
      folder: folderConfig(openExport(7, [d1])),
      dashboards: [{ doc: d1, base: baseOf(doc("d1")) }],
      files: [repoFile(doc("d1"))],
      prState: "open",
    });

    const error = await failureOf(exportFolderSync(FOLDER, caller));

    expect(error.message).toBe(PR_CLOSE_MESSAGE);
    expect(error).toMatchObject({
      errorCode: "github_sync_export_pending",
      statusCode: 409,
    });
    expect(github.createGitHubExportPullRequest).not.toHaveBeenCalled();
    expect(syncState.writeFolderSyncConfig).not.toHaveBeenCalled();
  });
});

describe("configureFolderSync", () => {
  it("fails with github_sync_invalid_link before any write when the owner is invalid", async () => {
    const d1 = doc("d1");
    seed({ dashboards: [{ doc: d1, base: baseOf(d1) }] });

    const error = await failureOf(
      configureFolderSync(FOLDER, caller, {
        owner: "bad owner!",
        repo: "dash",
      }),
    );

    expect(error.message).toBe('"bad owner!" is not a valid GitHub owner.');
    expect(error).toMatchObject({
      errorCode: "github_sync_invalid_link",
      statusCode: 400,
    });
    expect(syncState.writeDashboardSyncBase).not.toHaveBeenCalled();
    expect(syncState.writeFolderSyncConfig).not.toHaveBeenCalled();
    expect(github.assertGitHubBranch).not.toHaveBeenCalled();
  });

  it("checks the trimmed owner, repo, and default branch, then writes the link with path 'dashboards'", async () => {
    seed({ folder: null });

    const result = await configureFolderSync(FOLDER, caller, {
      owner: " acme ",
      repo: " dash ",
    });

    expect(result).toEqual({ folderId: FOLDER, link: LINK });
    expect(github.assertGitHubBranch).toHaveBeenCalledWith(
      caller.credential,
      "acme",
      "dash",
      "main",
    );
    expect(syncState.writeFolderSyncConfig).toHaveBeenCalledWith(
      FOLDER,
      ACCESS,
      {
        link: LINK,
        pendingExport: null,
      },
    );
    expect(
      vi.mocked(github.assertGitHubBranch).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(syncState.writeFolderSyncConfig).mock.invocationCallOrder[0],
    );
  });

  it("clears the base of every editable dashboard and writes a null config when unlinking", async () => {
    const mine = doc("d1");
    const theirs = doc("d2");
    seed({
      dashboards: [
        { doc: mine, base: baseOf(mine) },
        { doc: theirs, canEdit: false, base: baseOf(theirs) },
      ],
    });

    const result = await configureFolderSync(FOLDER, caller, null);

    expect(result).toEqual({ folderId: FOLDER, link: null });
    expect(syncState.writeDashboardSyncBase).toHaveBeenCalledTimes(1);
    expect(syncState.writeDashboardSyncBase).toHaveBeenCalledWith(
      "d1",
      ACCESS,
      null,
    );
    expect(syncState.writeFolderSyncConfig).toHaveBeenCalledWith(
      FOLDER,
      ACCESS,
      null,
    );
    expect(github.assertGitHubBranch).not.toHaveBeenCalled();
  });

  it("refuses to change the link while an export PR is open", async () => {
    const d1 = doc("d1", [["a", "v2"]]);
    seed({
      folder: folderConfig(openExport(7, [d1])),
      dashboards: [{ doc: d1, base: baseOf(doc("d1")) }],
      prState: "open",
    });

    const error = await failureOf(
      configureFolderSync(FOLDER, caller, { owner: "acme", repo: "other" }),
    );

    expect(error.message).toBe(
      "Export PR #7 is still open. Merge or close it before syncing or changing this folder's GitHub link.",
    );
    expect(error).toMatchObject({
      errorCode: "github_sync_export_pending",
      statusCode: 409,
    });
    expect(syncState.writeDashboardSyncBase).not.toHaveBeenCalled();
    expect(syncState.writeFolderSyncConfig).not.toHaveBeenCalled();
    expect(github.assertGitHubBranch).not.toHaveBeenCalled();
  });
});
