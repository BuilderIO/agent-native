import type { H3Event } from "h3";

import { isInBackgroundFunctionRuntime } from "../agent/durable-background.js";
import { INTEGRATION_RETRY_SWEEP_PATH } from "../integrations/integration-durable-dispatch-config.js";
import { markNetlifyAppActivity } from "../jobs/netlify-wake-marker.js";
import { RECURRING_JOBS_SWEEP_PATH } from "../jobs/scheduler-dispatch.js";
import { isNetlifyRecurringJobsRuntime } from "./agent-chat/recurring-jobs-runtime.js";
import { platformWaitUntil, runInBackground } from "./background-work.js";
import { isWorkspaceRuntime } from "./derived-secret.js";

/** The slice of a Nitro app this hook needs. */
export interface NetlifyActivityMarkHost {
  hooks?: {
    hook?: (
      name: "request",
      handler: (event: H3Event) => Promise<void>,
    ) => unknown;
  };
}

const installedApps = new WeakSet<object>();

/**
 * Marks request activity for the Netlify idle sweep (see
 * `jobs/netlify-wake-marker.ts`), so the first visitor after a quiet period
 * puts the sweep back on its minute cadence. Requests to the background
 * function (the sweep, and automation, agent and A2A work handed to it) and the
 * integration recovery cron are not visitors and are never marked. Workspace
 * deploys keep their every-minute sweep and write nothing.
 */
export function installNetlifyActivityMarkHook(
  nitroApp: NetlifyActivityMarkHost | null | undefined,
): void {
  const hook = nitroApp?.hooks?.hook;
  if (!nitroApp || !hook || installedApps.has(nitroApp)) return;
  if (!isNetlifyRecurringJobsRuntime() || isInBackgroundFunctionRuntime()) {
    return;
  }
  installedApps.add(nitroApp);
  hook.call(nitroApp.hooks, "request", async (event) => {
    try {
      const { pathname } = event.url;
      if (
        pathname.endsWith(RECURRING_JOBS_SWEEP_PATH) ||
        pathname.endsWith(INTEGRATION_RETRY_SWEEP_PATH)
      ) {
        return;
      }
      if (isWorkspaceRuntime()) return;
      const pending = markNetlifyAppActivity();
      if (pending) await runInBackground(pending, platformWaitUntil(event.req));
    } catch (error) {
      console.warn(
        "[recurring-jobs] Could not mark request activity for the idle sweep:",
        error instanceof Error ? error.message : error,
      );
    }
  });
}
