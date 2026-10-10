import { fail } from "@agent-native/core/action";
import type { CredentialContext } from "@agent-native/core/credentials";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

import {
  assertValidDashboardConfig,
  validatePanelSql,
} from "../../../actions/update-dashboard";
import type {
  ApplyFolderSyncResult,
  DashboardFolderSyncPreview,
  DashboardSyncBase,
  DashboardSyncRow,
  ExportFolderSyncResult,
  FolderGitHubSyncConfig,
  GitHubFolderLink,
  PendingDashboardExport,
} from "../../../shared/dashboard-github-sync";
import { requireRequestCredentialContext } from "../credentials-context";
import { requireEditableDashboard } from "../dashboard-agent-write";
import { queueDashboardCollabSync } from "../dashboard-collab-sync";
import {
  assignDashboardToFolder,
  type DashboardFolderContext,
} from "../dashboard-folders-store";
import {
  getDashboard,
  upsertDashboard,
  upsertDashboardWithRetryOutcome,
} from "../dashboards-store";
import {
  assertGitHubBranch,
  createGitHubExportPullRequest,
  getGitHubPullRequestState,
  listGitHubFolderFiles,
  readGitHubFile,
} from "./github";
import {
  type DashboardDocument,
  applyPullPlan,
  classifyDashboardSync,
  hashJson,
  parseDashboardFile,
  planPull,
  planPush,
  type PullPlan,
  unitHashes,
} from "./plan";
import {
  listFolderSqlDashboards,
  readDashboardFolderId,
  readDashboardSyncBase,
  readFolderSyncConfig,
  writeDashboardSyncBase,
  writeFolderSyncConfig,
} from "./state";

const FILE_SUFFIX = ".json";
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/;

export interface SyncCaller {
  email: string;
  orgId: string | null;
  credential: CredentialContext;
}

export interface GitHubLinkInput {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
}

type PullState = "open" | "merged" | "closed";

export function syncCallerFromRequest(): SyncCaller {
  const email = getRequestUserEmail();
  if (!email) {
    fail("Sign in to sync dashboards with GitHub.", {
      errorCode: "unauthenticated",
      statusCode: 401,
    });
  }
  return {
    email,
    orgId: getRequestOrgId() || null,
    credential: requireRequestCredentialContext("GITHUB_TOKEN"),
  };
}

function access(caller: SyncCaller) {
  return { email: caller.email, orgId: caller.orgId };
}

function folderContext(caller: SyncCaller): DashboardFolderContext {
  return { email: caller.email, orgId: caller.orgId };
}

function dashboardFilePath(link: GitHubFolderLink, dashboardId: string) {
  return link.path
    ? `${link.path}/${dashboardId}${FILE_SUFFIX}`
    : `${dashboardId}${FILE_SUFFIX}`;
}

function idFromFileName(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.slice(0, -FILE_SUFFIX.length);
}

async function listFolderFiles(caller: SyncCaller, link: GitHubFolderLink) {
  const files = await listGitHubFolderFiles(caller.credential, link);
  return new Map(files.map((file) => [idFromFileName(file.path), file]));
}

async function readRepoDocument(
  caller: SyncCaller,
  link: GitHubFolderLink,
  file: { path: string },
  dashboardId: string,
) {
  const got = await readGitHubFile(caller.credential, link, file.path);
  let repo: DashboardDocument;
  try {
    repo = parseDashboardFile(got.content);
  } catch (err) {
    // The parse message says what is wrong with the file, so it is shown as-is.
    fail(`${file.path}: ${err instanceof Error ? err.message : String(err)}`, {
      errorCode: "github_sync_invalid_file",
      statusCode: 422,
    });
  }
  if (repo.id !== dashboardId) {
    fail(
      `${file.path} contains dashboard "${repo.id}", but its file name is "${dashboardId}".`,
      { errorCode: "github_sync_id_mismatch", statusCode: 422 },
    );
  }
  if (repo.kind !== "sql") {
    fail(
      `${file.path} is a "${repo.kind}" dashboard. Only SQL dashboards sync with GitHub.`,
      { errorCode: "github_sync_unsupported_kind", statusCode: 422 },
    );
  }
  return { repo, sha: got.sha };
}

async function pendingState(
  caller: SyncCaller,
  config: FolderGitHubSyncConfig,
): Promise<PullState | null> {
  if (!config.pendingExport) return null;
  return getGitHubPullRequestState(
    caller.credential,
    config.link.owner,
    config.link.repo,
    config.pendingExport.prNumber,
  );
}

async function finalizePendingExport(
  caller: SyncCaller,
  folderId: string,
  config: FolderGitHubSyncConfig,
  state: "merged" | "closed",
): Promise<void> {
  const pending = config.pendingExport;
  if (!pending) return;
  // A merged export is now the repo's content, so its hashes become the base.
  // A closed export leaves the base alone, so the same changes export again.
  if (state === "merged") {
    // A dashboard deleted, moved out of the folder, or made read-only while its
    // export was open has no base to record. Skipping it keeps the folder from
    // refusing every sync until someone fixes that one row.
    const editable = new Map(
      (await listFolderSqlDashboards(folderId, access(caller)))
        .filter((record) => record.canEdit)
        .map((record) => [record.id, record]),
    );
    for (const [dashboardId, entry] of Object.entries(pending.dashboards)) {
      if (!editable.has(dashboardId)) continue;
      await writeDashboardSyncBase(dashboardId, access(caller), entry.base);
    }
  }
  await writeFolderSyncConfig(folderId, access(caller), {
    link: config.link,
    pendingExport: null,
  });
}

function requireLinkedFolder(config: FolderGitHubSyncConfig | null) {
  if (!config) {
    fail("This folder is not linked to GitHub. Link it first.", {
      errorCode: "github_sync_not_linked",
      statusCode: 409,
    });
  }
  return config;
}

function requireNoOpenExport(
  config: FolderGitHubSyncConfig,
  state: PullState | null,
) {
  if (state === "open" && config.pendingExport) {
    fail(
      `Export PR #${config.pendingExport.prNumber} is still open. Merge or close it before syncing or changing this folder's GitHub link.`,
      { errorCode: "github_sync_export_pending", statusCode: 409 },
    );
  }
}

async function clearDashboardBases(folderId: string, caller: SyncCaller) {
  for (const record of await listFolderSqlDashboards(
    folderId,
    access(caller),
  )) {
    if (!record.canEdit) continue;
    await writeDashboardSyncBase(record.id, access(caller), null);
  }
}

export async function configureFolderSync(
  folderId: string,
  caller: SyncCaller,
  input: GitHubLinkInput | null,
): Promise<{ folderId: string; link: GitHubFolderLink | null }> {
  const current = await readFolderSyncConfig(folderId, access(caller));
  if (current) {
    // Ask GitHub rather than trust the stored record, so a PR that merged since
    // the export is finalized instead of being reported as still open.
    const state = await pendingState(caller, current);
    requireNoOpenExport(current, state);
    if (state === "merged" || state === "closed") {
      await finalizePendingExport(caller, folderId, current, state);
    }
  }

  if (!input) {
    await clearDashboardBases(folderId, caller);
    await writeFolderSyncConfig(folderId, access(caller), null);
    return { folderId, link: null };
  }

  const owner = input.owner.trim();
  const repo = input.repo.trim();
  const branch = (input.branch ?? "main").trim();
  const path = (input.path ?? "dashboards").trim().replace(/^\/+|\/+$/g, "");
  if (!GITHUB_OWNER.test(owner)) {
    fail(`"${owner}" is not a valid GitHub owner.`, {
      errorCode: "github_sync_invalid_link",
      statusCode: 400,
    });
  }
  if (!GITHUB_REPO.test(repo)) {
    fail(`"${repo}" is not a valid GitHub repository name.`, {
      errorCode: "github_sync_invalid_link",
      statusCode: 400,
    });
  }
  if (!branch || branch.includes("..") || /[\s~^:?*[\\]/.test(branch)) {
    fail(`"${branch}" is not a valid branch name.`, {
      errorCode: "github_sync_invalid_link",
      statusCode: 400,
    });
  }
  if (
    !path ||
    path.split("/").some((segment) => !segment || segment === "..")
  ) {
    fail(`"${input.path}" is not a valid repo folder path.`, {
      errorCode: "github_sync_invalid_link",
      statusCode: 400,
    });
  }

  const link = { owner, repo, branch, path };
  // A typo'd branch would otherwise look like an empty folder on every read.
  await assertGitHubBranch(caller.credential, owner, repo, branch);
  // Bases describe one repo file per dashboard. A new link makes them meaningless,
  // so they are cleared only once the new link is known to be valid.
  await clearDashboardBases(folderId, caller);
  await writeFolderSyncConfig(folderId, access(caller), {
    link,
    pendingExport: null,
  });
  return { folderId, link };
}

export async function previewFolderSync(
  folderId: string,
  caller: SyncCaller,
): Promise<DashboardFolderSyncPreview> {
  const config = await readFolderSyncConfig(folderId, access(caller));
  if (!config)
    return { folderId, link: null, pendingExport: null, dashboards: [] };

  const state = await pendingState(caller, config);
  const pendingIds = new Set(
    Object.keys(config.pendingExport?.dashboards ?? {}),
  );
  const files = await listFolderFiles(caller, config.link);
  const records = await listFolderSqlDashboards(folderId, access(caller));

  const rows: DashboardSyncRow[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    seen.add(record.id);
    const filePath = dashboardFilePath(config.link, record.id);
    if (!record.canEdit) {
      rows.push(emptyRow(record.id, record.title, "no-access", filePath));
      continue;
    }
    if (state === "open" && pendingIds.has(record.id)) {
      rows.push(emptyRow(record.id, record.title, "export-pending", filePath));
      continue;
    }
    const base = await readDashboardSyncBase(record.id, access(caller));
    const file = files.get(record.id) ?? null;
    // An unchanged file (same blob SHA as the base) is not fetched.
    const repo =
      file && !(base && base.fileSha === file.sha)
        ? await readRepoDocument(caller, config.link, file, record.id)
        : null;
    const classified = classifyDashboardSync({
      base,
      filePath,
      repoSha: file?.sha ?? null,
      repo: repo?.repo ?? null,
      db: { id: record.id, kind: "sql", config: record.config },
    });
    rows.push({
      dashboardId: record.id,
      title: record.title,
      status: classified.status,
      filePath,
      conflicts: classified.conflicts,
      pullChanges: classified.pullChanges,
      exportChanges: classified.exportChanges,
    });
  }

  for (const [id, file] of files) {
    if (seen.has(id)) continue;
    const existing = await getDashboard(id, access(caller));
    if (existing) {
      rows.push(emptyRow(id, existing.title, "no-access", file.path));
      continue;
    }
    const { repo } = await readRepoDocument(caller, config.link, file, id);
    const classified = classifyDashboardSync({
      base: null,
      filePath: file.path,
      repoSha: file.sha,
      repo,
      db: null,
    });
    rows.push({
      dashboardId: id,
      title: repoTitle(repo),
      status: classified.status,
      filePath: file.path,
      conflicts: classified.conflicts,
      pullChanges: classified.pullChanges,
      exportChanges: classified.exportChanges,
    });
  }

  return {
    folderId,
    link: config.link,
    pendingExport:
      config.pendingExport && state
        ? {
            prNumber: config.pendingExport.prNumber,
            prUrl: config.pendingExport.prUrl,
            state,
          }
        : null,
    dashboards: rows,
  };
}

function emptyRow(
  dashboardId: string,
  title: string,
  status: DashboardSyncRow["status"],
  filePath: string,
): DashboardSyncRow {
  return {
    dashboardId,
    title,
    status,
    filePath,
    conflicts: [],
    pullChanges: [],
    exportChanges: [],
  };
}

function repoTitle(doc: DashboardDocument): string {
  const { title, name } = doc.config;
  if (typeof title === "string") return title;
  if (typeof name === "string") return name;
  return doc.id;
}

async function pullIntoDashboard(
  caller: SyncCaller,
  dashboardId: string,
  input: {
    base: DashboardSyncBase | null;
    filePath: string;
    repoSha: string;
    repo: DashboardDocument;
  },
): Promise<{ title: string; changes: string[]; conflicts: string[] }> {
  const planned: { plan: PullPlan | null } = { plan: null };
  const outcome = await upsertDashboardWithRetryOutcome(
    dashboardId,
    access(caller),
    async (existing) => {
      await requireEditableDashboard(dashboardId, access(caller), existing);
      const db: DashboardDocument = {
        id: dashboardId,
        kind: "sql",
        config: existing.config,
      };
      const plan = planPull({
        base: input.base,
        filePath: input.filePath,
        repoSha: input.repoSha,
        repo: input.repo,
        db,
      });
      planned.plan = plan;
      const next = applyPullPlan(db, input.repo, plan);
      assertValidDashboardConfig(next.config, { baseline: existing.config });
      if (plan.panelOps.length > 0) {
        const sqlError = await validatePanelSql(next.config);
        if (sqlError) fail(sqlError);
      }
      return { kind: "sql" as const, body: next.config };
    },
  );
  if (!planned.plan) throw new Error("GitHub sync planned no changes");

  // Recording the base after the write is safe to repeat. If this step fails,
  // the next pull sees the repo content already in the DB and converges.
  await writeDashboardSyncBase(
    dashboardId,
    access(caller),
    planned.plan.nextBase,
  );
  if (outcome.didWrite) {
    void queueDashboardCollabSync(
      dashboardId,
      outcome.dashboard.updatedAt,
      () => getDashboard(dashboardId, access(caller)),
    );
  }
  return {
    title: outcome.dashboard.title,
    changes: planned.plan.changes,
    conflicts: planned.plan.conflicts,
  };
}

async function createDashboardFromFile(
  caller: SyncCaller,
  folderId: string,
  input: { filePath: string; repoSha: string; repo: DashboardDocument },
): Promise<{ title: string; changes: string[] }> {
  const plan = planPull({
    base: null,
    filePath: input.filePath,
    repoSha: input.repoSha,
    repo: input.repo,
    db: null,
  });
  const doc = applyPullPlan(null, input.repo, plan);
  assertValidDashboardConfig(doc.config);
  const sqlError = await validatePanelSql(doc.config);
  if (sqlError) fail(sqlError);

  const created = await upsertDashboard(
    doc.id,
    "sql",
    doc.config,
    access(caller),
  );
  await assignDashboardToFolder(doc.id, folderId, folderContext(caller));
  await writeDashboardSyncBase(doc.id, access(caller), plan.nextBase);
  return { title: created.title, changes: plan.changes };
}

/**
 * Finishes a create that wrote the dashboard but failed before assigning its
 * folder. Adopts only a dashboard that sits in no folder and whose content
 * equals the file, so a user's own dashboard that happens to share the id is
 * never moved. Returns false for any other dashboard.
 */
async function adoptInterruptedCreate(
  caller: SyncCaller,
  folderId: string,
  dashboard: { id: string; config: Record<string, unknown>; canEdit?: boolean },
  file: { path: string },
  repoSha: string,
  repo: DashboardDocument,
): Promise<boolean> {
  if (dashboard.canEdit !== true) return false;
  if ((await readDashboardFolderId(dashboard.id, access(caller))) !== null) {
    return false;
  }
  const db: DashboardDocument = {
    id: dashboard.id,
    kind: "sql",
    config: dashboard.config,
  };
  if (hashJson(unitHashes(db)) !== hashJson(unitHashes(repo))) return false;

  const plan = planPull({
    base: null,
    filePath: file.path,
    repoSha,
    repo,
    db,
  });
  if (plan.nextBase === null) {
    throw new Error("identical dashboard content cannot conflict on adoption");
  }
  await assignDashboardToFolder(dashboard.id, folderId, folderContext(caller));
  await writeDashboardSyncBase(dashboard.id, access(caller), plan.nextBase);
  return true;
}

export async function applyFolderSync(
  folderId: string,
  caller: SyncCaller,
): Promise<ApplyFolderSyncResult> {
  const config = requireLinkedFolder(
    await readFolderSyncConfig(folderId, access(caller)),
  );
  const state = await pendingState(caller, config);
  requireNoOpenExport(config, state);
  let finalizedExport: "merged" | "closed" | null = null;
  if (config.pendingExport && (state === "merged" || state === "closed")) {
    await finalizePendingExport(caller, folderId, config, state);
    finalizedExport = state;
  }

  const files = await listFolderFiles(caller, config.link);
  const records = await listFolderSqlDashboards(folderId, access(caller));
  const applied: ApplyFolderSyncResult["applied"] = [];
  const skipped: ApplyFolderSyncResult["skipped"] = [];
  const seen = new Set<string>();

  for (const record of records) {
    seen.add(record.id);
    if (!record.canEdit) {
      skipped.push({ dashboardId: record.id, reason: "no edit access" });
      continue;
    }
    const file = files.get(record.id);
    if (!file) {
      skipped.push({ dashboardId: record.id, reason: "no file in GitHub" });
      continue;
    }
    const base = await readDashboardSyncBase(record.id, access(caller));
    if (base && base.fileSha === file.sha) continue;

    const { repo, sha } = await readRepoDocument(
      caller,
      config.link,
      file,
      record.id,
    );
    const result = await pullIntoDashboard(caller, record.id, {
      base,
      filePath: file.path,
      repoSha: sha,
      repo,
    });
    if (result.changes.length > 0 || result.conflicts.length > 0) {
      applied.push({
        dashboardId: record.id,
        title: result.title,
        created: false,
        changes: result.changes,
        conflicts: result.conflicts,
      });
    }
  }

  for (const [id, file] of files) {
    if (seen.has(id)) continue;
    const existing = await getDashboard(id, access(caller));
    if (existing) {
      const { repo, sha } = await readRepoDocument(
        caller,
        config.link,
        file,
        id,
      );
      if (
        await adoptInterruptedCreate(
          caller,
          folderId,
          existing,
          file,
          sha,
          repo,
        )
      ) {
        continue;
      }
      skipped.push({
        dashboardId: id,
        reason:
          "a dashboard with this id exists but is not in this folder or is not editable",
      });
      continue;
    }
    const { repo, sha } = await readRepoDocument(caller, config.link, file, id);
    const created = await createDashboardFromFile(caller, folderId, {
      filePath: file.path,
      repoSha: sha,
      repo,
    });
    applied.push({
      dashboardId: id,
      title: created.title,
      created: true,
      changes: created.changes,
      conflicts: [],
    });
  }

  return { folderId, finalizedExport, applied, skipped };
}

function exportTimestamp(now: Date) {
  return now.toISOString().replace(/\D/g, "").slice(0, 14);
}

export async function exportFolderSync(
  folderId: string,
  caller: SyncCaller,
): Promise<ExportFolderSyncResult> {
  const config = requireLinkedFolder(
    await readFolderSyncConfig(folderId, access(caller)),
  );
  const state = await pendingState(caller, config);
  requireNoOpenExport(config, state);
  if (config.pendingExport && (state === "merged" || state === "closed")) {
    await finalizePendingExport(caller, folderId, config, state);
  }

  const files = await listFolderFiles(caller, config.link);
  const records = await listFolderSqlDashboards(folderId, access(caller));
  const skipped: ExportFolderSyncResult["skipped"] = [];
  const exported: ExportFolderSyncResult["exported"] = [];
  const writes: Array<{ path: string; content: string }> = [];
  const pending: Record<string, PendingDashboardExport> = {};

  for (const record of records) {
    if (!record.canEdit) {
      skipped.push({ dashboardId: record.id, reason: "no edit access" });
      continue;
    }
    const filePath = dashboardFilePath(config.link, record.id);
    const base = await readDashboardSyncBase(record.id, access(caller));
    const push = planPush({
      base,
      filePath,
      repoSha: files.get(record.id)?.sha ?? null,
      db: { id: record.id, kind: "sql", config: record.config },
    });
    if (push.status === "in-sync") continue;
    if (push.status === "blocked") {
      skipped.push({ dashboardId: record.id, reason: push.reason });
      continue;
    }
    writes.push({ path: filePath, content: push.content });
    pending[record.id] = { blobSha: push.blobSha, base: push.base };
    exported.push({ dashboardId: record.id, changes: push.changes });
  }

  if (writes.length === 0) {
    return { folderId, prNumber: null, prUrl: null, exported, skipped };
  }

  const safeFolder = folderId.replace(/[^A-Za-z0-9-]/g, "-");
  const branch = `dashboard-sync/${safeFolder}-${exportTimestamp(new Date())}`;
  const count = exported.length;
  const pr = await createGitHubExportPullRequest(caller.credential, {
    link: config.link,
    branch,
    title: `Sync ${count} dashboard${count === 1 ? "" : "s"} from Agent-Native`,
    body: exported
      .map((item) => `- \`${item.dashboardId}\`: ${item.changes.join(", ")}`)
      .join("\n"),
    commitMessage: "Sync dashboards from Agent-Native",
    files: writes,
  });

  try {
    await writeFolderSyncConfig(folderId, access(caller), {
      link: config.link,
      pendingExport: {
        branch,
        prNumber: pr.prNumber,
        prUrl: pr.prUrl,
        dashboards: pending,
      },
    });
  } catch (err) {
    // The PR exists but nothing records it, so a retry would open a second one.
    // Naming the PR lets the user close it before exporting again.
    fail(
      `Opened ${pr.prUrl}, but could not record it. Close that PR before exporting again. ${err instanceof Error ? err.message : String(err)}`,
      { errorCode: "github_sync_export_unrecorded", statusCode: 500 },
    );
  }
  return {
    folderId,
    prNumber: pr.prNumber,
    prUrl: pr.prUrl,
    exported,
    skipped,
  };
}
