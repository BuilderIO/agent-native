import { defineAction } from "@agent-native/core/action";
import { getAutomationSchedulerHealth } from "@agent-native/core/jobs";
import { z } from "zod";

import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

const STALE_AFTER_MS = 3 * 60_000;

export default defineAction({
  description:
    "Inspect the Factory recurring-automation scheduler heartbeat and last error. Use this when an automation appears not to be running.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_, context) => {
    const { orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const [organizationHealth, globalHealth] = await Promise.all([
      getAutomationSchedulerHealth({
        appId: "factory",
        orgId,
      }),
      getAutomationSchedulerHealth({ appId: "factory", orgId: null }),
    ]);
    const health =
      [organizationHealth, globalHealth]
        .filter(
          (candidate): candidate is NonNullable<typeof candidate> =>
            candidate !== null && candidate.lastCheckedAt !== null,
        )
        .sort(
          (left, right) =>
            (right.lastCheckedAt ?? 0) - (left.lastCheckedAt ?? 0),
        )[0] ??
      organizationHealth ??
      globalHealth;
    const healthScope =
      health?.orgId === orgId ? ("organization" as const) : ("global" as const);
    if (!health?.lastCheckedAt) {
      return {
        status: "no-data" as const,
        lastCheckedAt: null,
        lastDispatchedAt: health?.lastDispatchedAt ?? null,
        lastError: health?.lastError ?? null,
        runtime: health?.runtime ?? null,
        scope: healthScope,
        staleAfterMs: STALE_AFTER_MS,
      };
    }
    const stale = Date.now() - health.lastCheckedAt > STALE_AFTER_MS;
    return {
      status: health.lastError
        ? ("error" as const)
        : stale
          ? ("stale" as const)
          : ("healthy" as const),
      lastCheckedAt: health.lastCheckedAt,
      lastDispatchedAt: health.lastDispatchedAt,
      lastError: health.lastError,
      runtime: health.runtime,
      scope: healthScope,
      staleAfterMs: STALE_AFTER_MS,
    };
  },
});
