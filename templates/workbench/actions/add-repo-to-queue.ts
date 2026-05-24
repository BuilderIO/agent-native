import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getGitHubConnection } from "../server/lib/github-connection.js";
import { getDispatchIntegrationsUrl } from "../server/lib/dispatch-url.js";

/**
 * Add a GitHub repo to the current user's Workbench queue.
 *
 * Validates the repo exists by calling `repos.get` via the shared workspace
 * GitHub integration. If the GitHub connection is missing/unhealthy, returns
 * a soft error with `connectUrl` so the UI can deep-link to Dispatch.
 *
 * Idempotent: if the same `(ownerEmail, owner, name)` row exists, return it
 * unchanged. Per-user scoping via `ownerEmail` from the request context.
 *
 * Accepts EITHER `{ owner, repo }` or `{ fullName: "owner/repo" }`.
 */
export default defineAction({
  description:
    "Add a GitHub repo to the current user's Workbench queue. Validates the " +
    "repo exists via the shared GitHub integration. Idempotent — returns the " +
    "existing row if the repo is already in the queue.",
  schema: z
    .object({
      owner: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
      fullName: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Convenience: 'owner/repo' string. Used when owner+repo aren't passed separately.",
        ),
    })
    .refine(
      (v) => Boolean(v.fullName) || (Boolean(v.owner) && Boolean(v.repo)),
      {
        message:
          "Provide either { owner, repo } or { fullName: 'owner/repo' }.",
      },
    ),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to add a repo to your queue.");
    }
    const orgId = getRequestOrgId() ?? null;

    let owner = args.owner?.trim() ?? "";
    let repo = args.repo?.trim() ?? "";
    if (!owner || !repo) {
      const fullName = args.fullName?.trim() ?? "";
      const slash = fullName.indexOf("/");
      if (slash <= 0 || slash === fullName.length - 1) {
        throw new Error(
          "Invalid fullName: expected 'owner/repo' (e.g. 'acme/api').",
        );
      }
      owner = fullName.slice(0, slash).trim();
      repo = fullName.slice(slash + 1).trim();
    }

    const db = getDb();

    // Idempotent: short-circuit before hitting GitHub.
    const existing = await db
      .select({
        id: schema.workbenchRepos.id,
        owner: schema.workbenchRepos.owner,
        name: schema.workbenchRepos.name,
        addedAt: schema.workbenchRepos.addedAt,
      })
      .from(schema.workbenchRepos)
      .where(
        and(
          eq(schema.workbenchRepos.ownerEmail, ownerEmail),
          eq(schema.workbenchRepos.owner, owner),
          eq(schema.workbenchRepos.name, repo),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return {
        ok: true,
        repo: existing[0],
        alreadyAdded: true,
      };
    }

    // Validate via the shared workspace GitHub integration.
    const octokit = await getGitHubConnection(ownerEmail, orgId ?? "");
    if (!octokit) {
      return {
        ok: false,
        connected: false,
        message:
          "Connect GitHub first — Workbench needs the shared workspace " +
          "GitHub integration to validate repos before adding them.",
        connectUrl: getDispatchIntegrationsUrl({
          provider: "github",
          appId: "workbench",
        }),
      };
    }

    try {
      await octokit.repos.get({ owner, repo });
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err && "status" in err
          ? (err as { status?: number }).status
          : undefined;
      if (status === 404) {
        throw new Error(
          `Repo not found or you don't have access to it: ${owner}/${repo}.`,
        );
      }
      throw new Error(
        `Couldn't validate ${owner}/${repo} with GitHub: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const row = {
      id: nanoid(),
      owner,
      name: repo,
      addedAt: new Date().toISOString(),
      ownerEmail,
      orgId: orgId ?? undefined,
      visibility: "private" as const,
    };

    await db.insert(schema.workbenchRepos).values(row);

    return {
      ok: true,
      repo: {
        id: row.id,
        owner: row.owner,
        name: row.name,
        addedAt: row.addedAt,
      },
      alreadyAdded: false,
    };
  },
});
