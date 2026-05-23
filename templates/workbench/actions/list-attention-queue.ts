import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { getDbExec } from "@agent-native/core/db";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getGitHubConnection } from "../server/lib/github-connection.js";

/**
 * Card types Workbench surfaces in the Attention Queue (v1.0).
 *
 * Keep in sync with `mute-card-type` and the card components under
 * `app/components/queue/`. Adding a type means: (1) extend this union,
 * (2) emit cards from the aggregator below, (3) render a card variant,
 * (4) include it in the mute dropdown.
 */
export type QueueCardType =
  | "pr-to-review"
  | "my-pr-status-change"
  | "my-pr-ci-failure"
  | "run-needs-input"
  | "error-new";

export interface QueueBadge {
  label: string;
  tone: "neutral" | "info" | "warning" | "danger" | "success";
}

export interface QueueCta {
  label: string;
  action: "open" | "snooze" | "dismiss" | "done";
  /** Optional href for the `"open"` action — falls back to a sane default. */
  href?: string;
}

export interface QueueCard {
  /** Stable per-user item id, e.g. `"pr:acme/api#1234"` or `"run:abc"`. */
  id: string;
  type: QueueCardType;
  title: string;
  subtitle?: string;
  badges: QueueBadge[];
  meta: {
    ageSeconds: number;
    risk?: "low" | "med" | "high";
  };
  ctas: QueueCta[];
  pr?: {
    owner: string;
    repo: string;
    number: number;
    htmlUrl: string;
    author?: string;
  };
  run?: {
    runId: string;
    threadId?: string;
  };
  error?: {
    sentryUrl?: string;
    service?: string;
  };
}

interface QueueDiagnostic {
  source: "github" | "runs" | "sentry";
  level: "info" | "warning" | "error";
  message: string;
}

interface QueueResponse {
  cards: QueueCard[];
  counts: {
    total: number;
    byType: Record<QueueCardType, number>;
  };
  /**
   * Snapshot of per-user filter state aggregated at request time. UI needs
   * this to render the mute toggles + know whether to nudge the user to
   * connect GitHub.
   */
  state: {
    githubConnected: boolean;
    mutedCardTypes: QueueCardType[];
  };
  diagnostics: QueueDiagnostic[];
}

/**
 * Aggregator for the Attention Queue room.
 *
 * Pulls cards from:
 *   - GitHub: PRs the user is requested to review across `workbench_repos`
 *   - GitHub: the user's own PRs with recent comments/reviews
 *   - GitHub Actions: the user's own PRs with failed required checks
 *   - run-manager: paused / errored runs the user owns
 *   - Sentry workspace integration: new errors in the last 24h (v1.0 stub
 *     — the shared connection provider isn't registered yet, so we just
 *     skip it gracefully)
 *
 * Per-user filtering (snooze / dismiss / done / mute) is applied here so
 * downstream UI just renders. Returned cards are pre-sorted by priority.
 */
export default defineAction({
  description:
    "List the Attention Queue cards for the current user, aggregated across GitHub PRs, local agent runs, and (optionally) Sentry errors.",
  schema: z.object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe("Maximum number of cards to return. Defaults to 50."),
  }),
  http: { method: "GET" },
  run: async (args): Promise<QueueResponse> => {
    const ownerEmail = getRequestUserEmail();
    const orgId = getRequestOrgId() ?? "";
    const diagnostics: QueueDiagnostic[] = [];

    if (!ownerEmail) {
      return {
        cards: [],
        counts: {
          total: 0,
          byType: emptyCounts(),
        },
        state: { githubConnected: false, mutedCardTypes: [] },
        diagnostics: [
          {
            source: "github",
            level: "info",
            message: "Sign in to load your Attention Queue.",
          },
        ],
      };
    }

    const [mutedTypes, queueState, repos, octokit] = await Promise.all([
      loadMutedCardTypes(ownerEmail),
      loadQueueStateMap(ownerEmail),
      loadRepos(ownerEmail, orgId),
      getGitHubConnectionSafe(ownerEmail, orgId).catch((err) => {
        diagnostics.push({
          source: "github",
          level: "warning",
          message: `GitHub helper failed to load: ${String(err?.message ?? err)}`,
        });
        return null;
      }),
    ]);

    const cards: QueueCard[] = [];

    // ── GitHub cards ────────────────────────────────────────────────────
    if (octokit && repos.length > 0) {
      // The three GitHub card types share a fetch pass per repo, so run them
      // together to avoid hammering the API. Each helper produces zero or
      // more cards filtered to the current user.
      await Promise.all(
        repos.map(async (repo) => {
          try {
            const prs = await octokit.pulls.list({
              owner: repo.owner,
              repo: repo.name,
              state: "open",
              per_page: 30,
              sort: "updated",
              direction: "desc",
            });
            for (const pr of prs.data) {
              const author = pr.user?.login;
              const reviewers = (pr.requested_reviewers ?? [])
                .map((r) => r?.login)
                .filter((s): s is string => !!s);
              const userLogin = matchUserLogin(ownerEmail);
              const isUserReviewer =
                userLogin !== null && reviewers.includes(userLogin);
              const isUserAuthor = userLogin !== null && author === userLogin;

              if (isUserReviewer) {
                const card = buildPrToReviewCard({
                  owner: repo.owner,
                  repo: repo.name,
                  pr,
                });
                if (card && !isMuted(card, mutedTypes)) {
                  pushIfActive(cards, card, queueState);
                }
              }

              if (isUserAuthor) {
                // PR status change card — comments/reviews since last-seen
                const statusCard = buildMyPrStatusChangeCard({
                  owner: repo.owner,
                  repo: repo.name,
                  pr,
                  queueState,
                });
                if (statusCard && !isMuted(statusCard, mutedTypes)) {
                  pushIfActive(cards, statusCard, queueState);
                }

                // CI failure card — needs a separate fetch on the head SHA.
                // Skip silently on failure; CI is best-effort.
                try {
                  const ciCard = await buildMyPrCiFailureCard({
                    owner: repo.owner,
                    repo: repo.name,
                    pr,
                    octokit,
                  });
                  if (ciCard && !isMuted(ciCard, mutedTypes)) {
                    pushIfActive(cards, ciCard, queueState);
                  }
                } catch (err) {
                  diagnostics.push({
                    source: "github",
                    level: "warning",
                    message: `GitHub Actions fetch failed for ${repo.owner}/${repo.name}#${pr.number}: ${describeError(err)}`,
                  });
                }
              }
            }
          } catch (err) {
            diagnostics.push({
              source: "github",
              level: "warning",
              message: `Could not list PRs for ${repo.owner}/${repo.name}: ${describeError(err)}`,
            });
          }
        }),
      );
    } else if (!octokit && repos.length > 0) {
      diagnostics.push({
        source: "github",
        level: "info",
        message:
          "Connect GitHub via Dispatch to populate PR cards (Settings > Connect GitHub).",
      });
    }

    // ── Run cards ───────────────────────────────────────────────────────
    if (!mutedTypes.has("run-needs-input")) {
      try {
        const runCards = await loadRunNeedsInputCards(ownerEmail, queueState);
        for (const card of runCards) {
          pushIfActive(cards, card, queueState);
        }
      } catch (err) {
        diagnostics.push({
          source: "runs",
          level: "warning",
          message: `Could not load runs: ${describeError(err)}`,
        });
      }
    }

    // ── Sentry cards ────────────────────────────────────────────────────
    // The framework's shared workspace-connection catalog doesn't include a
    // first-party Sentry provider yet, so we skip silently in v1.0. When it
    // lands, drop the helper in here. This is intentional — the spec lists
    // Sentry as optional.
    if (!mutedTypes.has("error-new")) {
      diagnostics.push({
        source: "sentry",
        level: "info",
        message:
          "Sentry workspace integration is not registered yet; error cards will appear once it ships.",
      });
    }

    sortByPriority(cards);

    const limited = cards.slice(0, args.limit);
    const counts = emptyCounts();
    for (const c of limited) {
      counts[c.type]++;
    }

    return {
      cards: limited,
      counts: {
        total: limited.length,
        byType: counts,
      },
      state: {
        githubConnected: octokit !== null,
        mutedCardTypes: Array.from(mutedTypes) as QueueCardType[],
      },
      diagnostics,
    };
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function emptyCounts(): Record<QueueCardType, number> {
  return {
    "pr-to-review": 0,
    "my-pr-status-change": 0,
    "my-pr-ci-failure": 0,
    "run-needs-input": 0,
    "error-new": 0,
  };
}

async function loadMutedCardTypes(
  ownerEmail: string,
): Promise<Set<QueueCardType>> {
  const db = getDb();
  const rows = await db
    .select({ cardType: schema.workbenchMutedTypes.cardType })
    .from(schema.workbenchMutedTypes)
    .where(eq(schema.workbenchMutedTypes.ownerEmail, ownerEmail));
  return new Set(rows.map((r) => r.cardType as QueueCardType));
}

interface QueueStateEntry {
  snoozedUntil: string | null;
  dismissedAt: string | null;
  doneAt: string | null;
  lastSeenAt: string | null;
}

type QueueStateMap = Map<string, QueueStateEntry>;

async function loadQueueStateMap(ownerEmail: string): Promise<QueueStateMap> {
  const db = getDb();
  const rows = await db
    .select({
      itemKey: schema.workbenchQueueState.itemKey,
      snoozedUntil: schema.workbenchQueueState.snoozedUntil,
      dismissedAt: schema.workbenchQueueState.dismissedAt,
      doneAt: schema.workbenchQueueState.doneAt,
      lastSeenAt: schema.workbenchQueueState.lastSeenAt,
    })
    .from(schema.workbenchQueueState)
    .where(eq(schema.workbenchQueueState.ownerEmail, ownerEmail));
  const map: QueueStateMap = new Map();
  for (const r of rows) {
    map.set(r.itemKey, {
      snoozedUntil: r.snoozedUntil ?? null,
      dismissedAt: r.dismissedAt ?? null,
      doneAt: r.doneAt ?? null,
      lastSeenAt: r.lastSeenAt ?? null,
    });
  }
  return map;
}

async function loadRepos(
  ownerEmail: string,
  orgId: string,
): Promise<Array<{ owner: string; name: string }>> {
  const db = getDb();
  // Match `ownableColumns()` scoping: rows the user owns within the active
  // org (or rows with no org assigned). Org-shared repos via `visibility="org"`
  // are also surfaced when the user is in that org.
  const conditions = [eq(schema.workbenchRepos.ownerEmail, ownerEmail)];
  if (orgId) {
    conditions.push(
      and(
        eq(schema.workbenchRepos.visibility, "org"),
        eq(schema.workbenchRepos.orgId, orgId),
      )!,
    );
  }
  const rows = await db
    .select({
      owner: schema.workbenchRepos.owner,
      name: schema.workbenchRepos.name,
    })
    .from(schema.workbenchRepos)
    .where(or(...conditions));
  // De-dupe by owner/name in case the user has overlapping personal + org rows.
  const seen = new Set<string>();
  const out: Array<{ owner: string; name: string }> = [];
  for (const r of rows) {
    const key = `${r.owner}/${r.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner: r.owner, name: r.name });
  }
  return out;
}

async function getGitHubConnectionSafe(ownerEmail: string, orgId: string) {
  try {
    return await getGitHubConnection(ownerEmail, orgId);
  } catch {
    return null;
  }
}

function isMuted(card: QueueCard, mutedTypes: Set<QueueCardType>): boolean {
  return mutedTypes.has(card.type);
}

/**
 * Apply queue-state filters (snooze / dismiss / done) before pushing a
 * card. Snoozed items resurface once the snooze window passes; dismissed
 * and done items stay hidden until the user actively snoozes or unmutes.
 */
function pushIfActive(
  out: QueueCard[],
  card: QueueCard,
  state: QueueStateMap,
): void {
  const entry = state.get(card.id);
  if (!entry) {
    out.push(card);
    return;
  }
  if (entry.dismissedAt) return;
  if (entry.doneAt) return;
  if (entry.snoozedUntil) {
    const wakeAt = Date.parse(entry.snoozedUntil);
    if (Number.isFinite(wakeAt) && wakeAt > Date.now()) return;
  }
  out.push(card);
}

// ─── Card builders ───────────────────────────────────────────────────────

interface GhPr {
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  head: { sha: string };
  draft?: boolean;
  requested_reviewers?: Array<{ login?: string } | null> | null;
  comments?: number;
  review_comments?: number;
  changed_files?: number;
}

function buildPrToReviewCard(input: {
  owner: string;
  repo: string;
  pr: GhPr;
}): QueueCard | null {
  const { owner, repo, pr } = input;
  if (pr.draft) return null;
  const id = `pr:${owner}/${repo}#${pr.number}`;
  const ageSeconds = ageInSeconds(pr.created_at);
  const risk = riskFromAge(ageSeconds);
  const badges: QueueBadge[] = [{ label: "Review request", tone: "info" }];
  if (risk === "high") {
    badges.push({
      label: `${Math.floor(ageSeconds / 86400)}d old`,
      tone: "warning",
    });
  }
  return {
    id,
    type: "pr-to-review",
    title: `${owner}/${repo} #${pr.number} — ${pr.title}`,
    subtitle: pr.user?.login
      ? `${pr.user.login}${pr.changed_files != null ? ` · ${pr.changed_files} files` : ""}`
      : undefined,
    badges,
    meta: { ageSeconds, risk },
    ctas: [
      { label: "Review", action: "open", href: pr.html_url },
      { label: "Snooze", action: "snooze" },
      { label: "Dismiss", action: "dismiss" },
    ],
    pr: {
      owner,
      repo,
      number: pr.number,
      htmlUrl: pr.html_url,
      author: pr.user?.login,
    },
  };
}

function buildMyPrStatusChangeCard(input: {
  owner: string;
  repo: string;
  pr: GhPr;
  queueState: QueueStateMap;
}): QueueCard | null {
  const { owner, repo, pr, queueState } = input;
  // The "status change" signal in v1.0 is: the PR was updated more
  // recently than the user's last-seen marker for this card. If we have
  // no last-seen marker we still show it the first time so the user has
  // a chance to acknowledge it.
  const id = `pr:${owner}/${repo}#${pr.number}:status`;
  const entry = queueState.get(id);
  const updatedAt = Date.parse(pr.updated_at);
  if (entry?.lastSeenAt) {
    const seenAt = Date.parse(entry.lastSeenAt);
    if (
      Number.isFinite(seenAt) &&
      Number.isFinite(updatedAt) &&
      updatedAt <= seenAt
    ) {
      return null;
    }
  }
  const ageSeconds = ageInSeconds(pr.updated_at);
  const commentCount = (pr.comments ?? 0) + (pr.review_comments ?? 0);
  return {
    id,
    type: "my-pr-status-change",
    title: `Your PR ${owner}/${repo} #${pr.number} — ${pr.title}`,
    subtitle:
      commentCount > 0
        ? `${commentCount} comment${commentCount === 1 ? "" : "s"} · updated ${formatRelative(ageSeconds)}`
        : `Updated ${formatRelative(ageSeconds)}`,
    badges: [{ label: "Status update", tone: "info" }],
    meta: { ageSeconds },
    ctas: [
      { label: "Open PR", action: "open", href: pr.html_url },
      { label: "Snooze", action: "snooze" },
      { label: "Mark done", action: "done" },
    ],
    pr: {
      owner,
      repo,
      number: pr.number,
      htmlUrl: pr.html_url,
      author: pr.user?.login,
    },
  };
}

async function buildMyPrCiFailureCard(input: {
  owner: string;
  repo: string;
  pr: GhPr;
  octokit: NonNullable<Awaited<ReturnType<typeof getGitHubConnection>>>;
}): Promise<QueueCard | null> {
  const { owner, repo, pr, octokit } = input;
  const id = `pr:${owner}/${repo}#${pr.number}:ci`;
  const checks = await octokit.checks.listForRef({
    owner,
    repo,
    ref: pr.head.sha,
    per_page: 30,
  });
  const failed = checks.data.check_runs.filter(
    (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
  );
  if (failed.length === 0) return null;

  const ageSeconds = ageInSeconds(pr.updated_at);
  return {
    id,
    type: "my-pr-ci-failure",
    title: `CI failed on ${owner}/${repo} #${pr.number}`,
    subtitle:
      failed.length === 1
        ? `${failed[0].name} failed`
        : `${failed.length} jobs red`,
    badges: [
      { label: "CI failure", tone: "danger" },
      { label: pr.title, tone: "neutral" },
    ],
    meta: { ageSeconds, risk: "high" },
    ctas: [
      { label: "Open PR", action: "open", href: pr.html_url },
      { label: "Snooze", action: "snooze" },
      { label: "Mark done", action: "done" },
    ],
    pr: {
      owner,
      repo,
      number: pr.number,
      htmlUrl: pr.html_url,
      author: pr.user?.login,
    },
  };
}

/**
 * Runs the user owns that recently paused or errored. The `agent_runs` SQL
 * table lives in core and is keyed by `thread_id`; we join through
 * `chat_threads.owner_email` so we only see this user's runs.
 *
 * "Needs input" in v1.0 = `status` in (`paused`, `errored`) and the run is
 * still recent (last hour). The run-manager surface uses `paused` for
 * agent-asks-question and `errored` for resumable failures.
 */
async function loadRunNeedsInputCards(
  ownerEmail: string,
  queueState: QueueStateMap,
): Promise<QueueCard[]> {
  const exec = getDbExec();
  // Limit the SELECT join scan with a recency window so we don't pay full
  // table cost on a busy chat history.
  const sinceMs = Date.now() - 60 * 60 * 1000; // last hour
  const { rows } = await exec.execute({
    sql: `SELECT r.id AS run_id,
                 r.thread_id AS thread_id,
                 r.status AS status,
                 r.started_at AS started_at,
                 t.title AS title
            FROM agent_runs r
            JOIN chat_threads t ON t.id = r.thread_id
            WHERE t.owner_email = ?
              AND r.status IN ('paused', 'errored')
              AND r.started_at >= ?
            ORDER BY r.started_at DESC
            LIMIT 25`,
    args: [ownerEmail, sinceMs],
  });

  const cards: QueueCard[] = [];
  for (const r of rows as Array<{
    run_id: string;
    thread_id: string;
    status: string;
    started_at: number | string;
    title: string | null;
  }>) {
    const id = `run:${r.run_id}`;
    const startedAt = Number(r.started_at);
    const ageSeconds = Number.isFinite(startedAt)
      ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      : 0;
    const isPaused = r.status === "paused";
    cards.push({
      id,
      type: "run-needs-input",
      title: r.title?.trim() || `Run ${r.run_id.slice(0, 8)}`,
      subtitle: isPaused
        ? `Paused — agent is waiting for input · ${formatRelative(ageSeconds)}`
        : `Errored — agent stopped · ${formatRelative(ageSeconds)}`,
      badges: [
        {
          label: isPaused ? "Paused" : "Errored",
          tone: isPaused ? "warning" : "danger",
        },
      ],
      meta: { ageSeconds, risk: isPaused ? "med" : "high" },
      ctas: [
        { label: "Open run", action: "open", href: `/runs/${r.run_id}` },
        { label: "Snooze", action: "snooze" },
        { label: "Mark done", action: "done" },
      ],
      run: { runId: r.run_id, threadId: r.thread_id },
    });
  }

  // De-dupe by id and drop snoozed/dismissed/done entries via the standard
  // pushIfActive helper at the caller side. Returning the unfiltered list
  // keeps the helper composable.
  return cards;
}

// ─── Sorting + utilities ────────────────────────────────────────────────

/**
 * Sort cards by priority (highest first):
 *   1. PRs with CI failure
 *   2. Runs needing input
 *   3. New errors
 *   4. PRs to review, oldest first
 *   5. Status updates on user's PRs
 */
const TYPE_PRIORITY: Record<QueueCardType, number> = {
  "my-pr-ci-failure": 100,
  "run-needs-input": 80,
  "error-new": 70,
  "pr-to-review": 50,
  "my-pr-status-change": 30,
};

function sortByPriority(cards: QueueCard[]): void {
  cards.sort((a, b) => {
    const dt = TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type];
    if (dt !== 0) return dt;
    // Within a tier, oldest wins (drives the "stale review" intuition).
    return b.meta.ageSeconds - a.meta.ageSeconds;
  });
}

function ageInSeconds(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function riskFromAge(ageSeconds: number): "low" | "med" | "high" {
  if (ageSeconds > 3 * 86400) return "high";
  if (ageSeconds > 86400) return "med";
  return "low";
}

function formatRelative(ageSeconds: number): string {
  if (ageSeconds < 60) return "just now";
  if (ageSeconds < 3600) {
    const m = Math.floor(ageSeconds / 60);
    return `${m}m ago`;
  }
  if (ageSeconds < 86400) {
    const h = Math.floor(ageSeconds / 3600);
    return `${h}h ago`;
  }
  const d = Math.floor(ageSeconds / 86400);
  return `${d}d ago`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Best-effort GitHub login resolution from an email. In v1.0 we just take
 * the local-part — most workspaces have `firstname@company.com` ≈ login.
 * A follow-up PR can teach this to look at `workbench_user_settings` or
 * the GitHub user record from the shared connection's account label.
 */
function matchUserLogin(email: string): string | null {
  const at = email.indexOf("@");
  if (at <= 0) return null;
  return email.slice(0, at).toLowerCase();
}
