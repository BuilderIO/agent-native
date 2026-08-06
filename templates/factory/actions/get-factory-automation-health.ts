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
    const health = await getAutomationSchedulerHealth({
      appId: "factory",
      orgId,
    });
    if (!health?.lastCheckedAt) {
      return {
        status: "no-data" as const,
        lastCheckedAt: null,
        lastDispatchedAt: health?.lastDispatchedAt ?? null,
        lastError: health?.lastError ?? null,
        runtime: health?.runtime ?? null,
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
      staleAfterMs: STALE_AFTER_MS,
    };
  },
});
