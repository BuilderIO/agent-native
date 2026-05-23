import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

/**
 * Repos the user has added to their queue. Workbench fetches PR data live
 * from GitHub per request — this table is just the list of "which repos do
 * I care about right now?".
 */
export const workbenchRepos = table("workbench_repos", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  addedAt: text("added_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * Per-user, per-item Attention Queue state. `itemKey` is a stable string
 * scoping the source + identity (e.g. `pr:acme/api#1234`, `run:abc`,
 * `error:payment-svc:14`). All four mutator flags are nullable so an
 * absent value means "not snoozed / not dismissed / not done".
 */
export const workbenchQueueState = table("workbench_queue_state", {
  id: text("id").primaryKey(),
  itemKey: text("item_key").notNull(),
  snoozedUntil: text("snoozed_until"),
  dismissedAt: text("dismissed_at"),
  doneAt: text("done_at"),
  lastSeenAt: text("last_seen_at"),
  ...ownableColumns(),
});

/**
 * Per-user PR-specific state — last reviewed time and a free-form flags
 * blob for things like "starred", "needs-second-review", etc.
 */
export const workbenchPrState = table("workbench_pr_state", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  number: integer("number").notNull(),
  lastReviewedAt: text("last_reviewed_at"),
  /** JSON blob of per-user PR flags. */
  flags: text("flags"),
  ...ownableColumns(),
});

/**
 * Cross-room link from a Workbench-monitored run to a PR. Populated by
 * `find-pr-from-run` / `find-run-that-authored-pr` (and direct hooks when
 * a run produces a PR Workbench knows about).
 */
export const workbenchRunPrLinks = table("workbench_run_pr_links", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  prOwner: text("pr_owner").notNull(),
  prRepo: text("pr_repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  linkedAt: text("linked_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * Team-saved review comment templates ("LGTM", "needs tests", "approving
 * with nit", etc.). Shareable to the org via `workbench_review_template_shares`.
 */
export const workbenchReviewTemplates = table("workbench_review_templates", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const workbenchReviewTemplateShares = createSharesTable(
  "workbench_review_template_shares",
);

/**
 * Per-user muted card types ("error", "draft-pr", etc.). When a card type
 * appears here, it stops surfacing in that user's queue without affecting
 * anyone else.
 */
export const workbenchMutedTypes = table("workbench_muted_types", {
  id: text("id").primaryKey(),
  cardType: text("card_type").notNull(),
  mutedAt: text("muted_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * Local filesystem workspaces the user has registered for the Code Room.
 *
 * `path` is an absolute filesystem path the server will read/write from.
 * Per-user only: scoped via `ownerEmail`. The server validates the path
 * exists + is a directory before insert, and every file/git op rooted at
 * `path` goes through `assertPathInWorkspace` so user-supplied relative
 * paths can never escape the workspace.
 */
export const workbenchCodeWorkspaces = table("workbench_code_workspaces", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  path: text("path").notNull(),
  isDefault: integer("is_default").notNull().default(0),
  addedAt: text("added_at").notNull().default(now()),
  ...ownableColumns(),
});

/**
 * Per-user, per-workspace remembered open files so the Code Room can
 * restore tabs across reloads. `filePath` is relative to the workspace
 * root. `isActive` flags the currently-foreground tab.
 */
export const workbenchOpenFiles = table("workbench_open_files", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  filePath: text("file_path").notNull(),
  openedAt: text("opened_at").notNull().default(now()),
  isActive: integer("is_active").notNull().default(0),
  ...ownableColumns(),
});
