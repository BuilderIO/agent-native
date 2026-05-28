import { defineAction } from "@agent-native/core";
import { accessFilter } from "@agent-native/core/sharing";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { and } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * Shape of a single PR card returned by `list-prs`. Mirrors what the Queue
 * widget uses so the agent / UI can render PR cards consistently across
 * the Queue and the dedicated `/prs` room.
 */
interface PRCard {
  /** Stable cross-source key: `pr:<owner>/<repo>#<number>`. */
  itemKey: string;
  type: "pr";
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  filesChanged: number | null;
  additions: number | null;
  deletions: number | null;
  ciStatus: "pending" | "success" | "failure" | "neutral" | "unknown";
  reviewDecision: "approved" | "changes_requested" | "review_required" | null;
}

function ageDays(updatedAt: string): number {
  const ms = Date.now() - new Date(updatedAt).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function sortKey(card: PRCard, sort: "priority" | "oldest" | "newest"): number {
  if (sort === "oldest") return new Date(card.updatedAt).getTime();
  if (sort === "newest") return -new Date(card.updatedAt).getTime();
  // Priority: failed CI first, then drafts last, then oldest-updated first.
  let score = 0;
  if (card.ciStatus === "failure") score -= 1_000_000;
  if (card.reviewDecision === "changes_requested") score -= 500_000;
  if (card.isDraft) score += 250_000;
  score += new Date(card.updatedAt).getTime() / 1000;
  return score;
}

export default defineAction({
  description:
    "List pull requests across all repos the user has added to Workbench. " +
    "Fetches live from GitHub via the shared workspace integration; returns " +
    "the same card shape used by the Attention Queue. Use this for the " +
    "`/prs` room or any external surface that wants the cross-repo PR list.",
  schema: z.object({
    filter: z
      .enum(["all", "open", "closed", "needs-review", "drafts"])
      .optional()
      .default("open")
      .describe(
        "Subset to return. `needs-review` filters to PRs the user is requested on or unreviewed.",
      ),
    sort: z
      .enum(["priority", "oldest", "newest"])
      .optional()
      .default("priority"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error("Sign in to list pull requests.");
    }
    const orgId = getRequestOrgId() || "";

    const octokit = await getGitHubConnection(userEmail, orgId);
    if (!octokit) {
      return {
        prs: [] as PRCard[],
        total: 0,
        connected: false,
        connectHint:
          "GitHub isn't connected to Workbench yet — connect it once in Dispatch and grant Workbench access.",
        connectUrl: getDispatchIntegrationsUrl({
          provider: "github",
          appId: "workbench",
        }),
      };
    }

    const db = getDb();
    const repos = await db
      .select()
      .from(schema.workbenchRepos)
      .where(and(accessFilter(schema.workbenchRepos, schema.workbenchRepos)));

    if (repos.length === 0) {
      return {
        prs: [] as PRCard[],
        total: 0,
        connected: true,
        connectHint:
          "No repos added yet — head to Settings to add a repo before PRs surface here.",
      };
    }

    const ghState =
      args.filter === "closed"
        ? "closed"
        : args.filter === "all"
          ? "all"
          : "open";

    const cards: PRCard[] = [];
    const errors: { repo: string; error: string }[] = [];

    await Promise.all(
      repos.map(async (repo) => {
        try {
          const { data } = await octokit.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: ghState,
            sort: "updated",
            direction: "desc",
            per_page: Math.min(args.limit, 50),
          });
          for (const pr of data) {
            const ciStatus = inferCiStatus(pr);
            const card: PRCard = {
              itemKey: `pr:${repo.owner}/${repo.name}#${pr.number}`,
              type: "pr",
              owner: repo.owner,
              repo: repo.name,
              number: pr.number,
              title: pr.title,
              url: pr.html_url,
              author: pr.user?.login ?? null,
              state: pr.merged_at ? "merged" : (pr.state as "open" | "closed"),
              isDraft: Boolean(pr.draft),
              createdAt: pr.created_at,
              updatedAt: pr.updated_at,
              ageDays: ageDays(pr.updated_at),
              filesChanged: null,
              additions: null,
              deletions: null,
              ciStatus,
              reviewDecision: null,
            };
            if (args.filter === "drafts" && !card.isDraft) continue;
            if (
              args.filter === "needs-review" &&
              pr.requested_reviewers &&
              pr.requested_reviewers.length === 0
            ) {
              continue;
            }
            cards.push(card);
          }
        } catch (error) {
          errors.push({
            repo: `${repo.owner}/${repo.name}`,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );

    cards.sort((a, b) => sortKey(a, args.sort) - sortKey(b, args.sort));
    const trimmed = cards.slice(0, args.limit);

    return {
      prs: trimmed,
      total: cards.length,
      connected: true,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});

/**
 * Heuristic CI status from the PR's `head` ref. `octokit.pulls.list` doesn't
 * include status checks inline — full CI status comes from `inspect-pr`.
 * Returning `"unknown"` lets the UI render a neutral pill for the list view
 * without an extra round-trip per PR.
 */
function inferCiStatus(_pr: unknown): PRCard["ciStatus"] {
  return "unknown";
}
