// Contract for GitHub folder sync. Shared by the server sync modules, the
// actions, and the folder sync dialog. Types only: no runtime imports.

/** Where a folder's dashboards live in a GitHub repo, one `<id>.json` each. */
export interface GitHubFolderLink {
  owner: string;
  repo: string;
  branch: string;
  /** Repo-relative directory, no leading or trailing slash. */
  path: string;
}

/**
 * What one dashboard looked like the last time it was in sync. Units are
 * compared by hash, so a change to one panel never conflicts with an edit to
 * another panel on the same dashboard.
 */
export interface DashboardSyncBase {
  /** Repo-relative file this base describes. */
  filePath: string;
  /** Git blob SHA of that file at the time the base was taken. */
  fileSha: string;
  /** Panel id -> hash of that panel's canonical JSON. */
  panels: Record<string, string>;
  /** Hash of the panel id sequence. */
  order: string;
  /** Hash of the config without `panels`, which includes the title. */
  meta: string;
}

export interface PendingDashboardExport {
  /** Git blob SHA of the file this export committed. */
  blobSha: string;
  /** Becomes the dashboard's base once the export PR merges. */
  base: DashboardSyncBase;
}

/** At most one export PR is open per folder at a time. */
export interface FolderPendingExport {
  branch: string;
  prNumber: number;
  prUrl: string;
  dashboards: Record<string, PendingDashboardExport>;
}

/** Stored in `dashboard_folders.github_sync`. Holds no credentials. */
export interface FolderGitHubSyncConfig {
  link: GitHubFolderLink;
  pendingExport: FolderPendingExport | null;
}

export type DashboardSyncStatus =
  /** Nothing changed on either side. */
  | "in-sync"
  /** GitHub has changes to pull. */
  | "github-changed"
  /** The app has changes to export. */
  | "app-changed"
  /** Both sides changed, but never the same unit. */
  | "both-changed"
  /** Both sides changed the same unit differently. Nothing is applied for it. */
  | "conflict"
  /** Dashboard in the folder with no file in GitHub yet. */
  | "not-exported"
  /** File in GitHub with no dashboard yet. Pull creates it. */
  | "new-in-github"
  /** File was deleted in GitHub. The dashboard is kept, and export refuses. */
  | "removed-in-github"
  /** An export PR for this dashboard is open. Pull and export wait for it. */
  | "export-pending"
  /** The user cannot edit this dashboard, so it is not touched. */
  | "no-access";

export interface DashboardSyncRow {
  dashboardId: string;
  title: string;
  status: DashboardSyncStatus;
  filePath: string;
  /** Units that conflict, such as `panel:<id>`, `order`, or `meta`. */
  conflicts: string[];
  /** Units that pull would change. */
  pullChanges: string[];
  /** Units that export would write. */
  exportChanges: string[];
}

export interface DashboardFolderSyncPreview {
  folderId: string;
  link: GitHubFolderLink | null;
  pendingExport: {
    prNumber: number;
    prUrl: string;
    state: "open" | "merged" | "closed";
  } | null;
  dashboards: DashboardSyncRow[];
}

export interface ApplyFolderSyncResult {
  folderId: string;
  /** Set when a previously open export PR was merged or closed during this run. */
  finalizedExport: "merged" | "closed" | null;
  applied: Array<{
    dashboardId: string;
    title: string;
    created: boolean;
    /** Units that pull applied. */
    changes: string[];
    /** Units that were left alone because both sides changed them. */
    conflicts: string[];
  }>;
  skipped: Array<{ dashboardId: string; reason: string }>;
}

export interface ExportFolderSyncResult {
  folderId: string;
  prNumber: number | null;
  prUrl: string | null;
  exported: Array<{ dashboardId: string; changes: string[] }>;
  skipped: Array<{ dashboardId: string; reason: string }>;
}

/** Action names, shared so the dialog and docs refer to the same surface. */
export const DASHBOARD_FOLDER_SYNC_ACTIONS = {
  configure: "configure-dashboard-folder-github-sync",
  preview: "preview-dashboard-folder-github-sync",
  apply: "apply-dashboard-folder-github-sync",
  export: "export-dashboard-folder-to-github",
} as const;
