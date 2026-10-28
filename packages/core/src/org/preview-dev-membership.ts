import { randomUUID } from "node:crypto";

import { getDbExec } from "../db/client.js";
import { isProductionServerBuild } from "../db/server-runtime.js";
import { isProductionLikeRuntime } from "../server/credential-provider.js";
import { invalidateMemberOrgCaches } from "./request-org-cache.js";

/**
 * Builder Workspace previews run with AUTH_DISABLED, so every request is the
 * `dev@local.test` session. That account has no org membership, so the
 * workspace's org-gated features would be empty in a preview. When the
 * preview launcher sets `WORKSPACE_PREVIEW_JOIN_ORG=1`, make the dev account a
 * member of the workspace's single org in the current database.
 */
export const PREVIEW_DEV_ACCOUNT_EMAIL = "dev@local.test";

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Hard guard. True only in a development runtime with AUTH_DISABLED and the
 * explicit opt-in. Never true for production-like runtimes, whatever else the
 * env says.
 */
export function shouldJoinPreviewDevOrg(
  env: NodeJS.ProcessEnv = process.env,
  runtime: { productionLike: boolean; productionBuild: boolean } = {
    productionLike: isProductionLikeRuntime(),
    productionBuild: isProductionServerBuild(),
  },
): boolean {
  if (runtime.productionLike || runtime.productionBuild) return false;
  if (env.NODE_ENV !== "development") return false;
  if (!truthy(env.AUTH_DISABLED)) return false;
  return env.WORKSPACE_PREVIEW_JOIN_ORG === "1";
}

export type PreviewDevOrgJoinResult =
  | { status: "skipped" }
  | { status: "no-org" }
  | { status: "ambiguous-org"; count: number }
  | { status: "joined" | "already-member"; orgId: string };

/** Idempotent: adds the dev account to the workspace's org if it is missing. */
export async function ensurePreviewDevOrgMembership(
  options: {
    env?: NodeJS.ProcessEnv;
    exec?: Pick<ReturnType<typeof getDbExec>, "execute">;
  } = {},
): Promise<PreviewDevOrgJoinResult> {
  if (!shouldJoinPreviewDevOrg(options.env ?? process.env)) {
    return { status: "skipped" };
  }
  const exec = options.exec ?? getDbExec();
  // A workspace has exactly one org; refuse to guess when there are several.
  const orgs = await exec.execute({
    sql: `SELECT id FROM organizations LIMIT 2`,
    args: [],
  });
  if (orgs.rows.length === 0) return { status: "no-org" };
  if (orgs.rows.length > 1) {
    return { status: "ambiguous-org", count: orgs.rows.length };
  }
  const orgId = String((orgs.rows[0] as { id: unknown }).id);
  const existing = await exec.execute({
    sql: `SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
    args: [orgId, PREVIEW_DEV_ACCOUNT_EMAIL],
  });
  if (existing.rows.length > 0) return { status: "already-member", orgId };
  await exec.execute({
    sql: `INSERT INTO org_members (id, org_id, email, role, joined_at)
          VALUES (?, ?, ?, 'member', ?)
          ON CONFLICT (org_id, LOWER(email)) DO NOTHING`,
    args: [randomUUID(), orgId, PREVIEW_DEV_ACCOUNT_EMAIL, Date.now()],
  });
  invalidateMemberOrgCaches();
  return { status: "joined", orgId };
}

/** Startup hook: tries now, then retries briefly until the org exists. */
export function schedulePreviewDevOrgMembership(): void {
  if (!shouldJoinPreviewDevOrg()) return;
  let attempts = 0;
  const attempt = async () => {
    attempts += 1;
    try {
      const result = await ensurePreviewDevOrgMembership();
      if (result.status === "no-org" && attempts < 30) {
        setTimeout(attempt, 5_000).unref?.();
        return;
      }
      if (result.status === "ambiguous-org") {
        console.warn(
          `[agent-native] WORKSPACE_PREVIEW_JOIN_ORG: ${result.count}+ organizations found; skipping dev account join`,
        );
      }
    } catch (error) {
      console.warn("[agent-native] preview dev org join failed:", error);
    }
  };
  void attempt();
}
