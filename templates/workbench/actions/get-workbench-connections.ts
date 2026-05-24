import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import {
  getGitHubConnectionStatus,
  type GitHubConnectionStatus,
} from "../server/lib/github-connection.js";

/**
 * Returns the status of every workspace integration Workbench uses, in
 * one round trip. The Settings page (`app/routes/settings.tsx`) calls
 * this on mount; the agent calls it when the user asks "is GitHub
 * connected?" or "what do I still need to set up?"
 *
 * GitHub is required (queue PR cards + the PR Room don't function
 * without it). Sentry is optional and lands in a v1.1 follow-up; for now
 * it's reported as `comingSoon: true` so the UI can render a "Coming
 * soon" badge without pretending to have a connect flow.
 *
 * Per `templates/workbench/AGENTS.md`: connections are NEVER wired with
 * Workbench-owned OAuth. Connect once in Dispatch, grant Workbench
 * access, reuse across apps. The `github.connectUrl` returned here is
 * the Dispatch deep link the UI sends the user to.
 */

interface WorkbenchConnectionsResult {
  github: GitHubConnectionStatus;
  sentry: {
    /**
     * v1.0 always reports `false` — Sentry-in-queue lands in v1.1 per
     * the PRD §15 roadmap. The Settings page renders this as a "Coming
     * soon" badge rather than a connect CTA.
     */
    connected: false;
    /**
     * Always `true` in v1.0; flip to `false` and add real status when
     * the Sentry workspace integration ships.
     */
    comingSoon: true;
  };
}

export default defineAction({
  description:
    "Get the status of every workspace integration Workbench uses (GitHub via the shared workspace integration; Sentry placeholder for v1.1). Use this to answer 'is GitHub connected?' or 'what do I still need to set up in Workbench?' GitHub is connected once in Dispatch and granted to Workbench.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (): Promise<WorkbenchConnectionsResult> => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw new Error(
        "get-workbench-connections requires an authenticated user.",
      );
    }
    const orgId = getRequestOrgId() ?? "";

    const github = await getGitHubConnectionStatus(userEmail, orgId);

    return {
      github,
      sentry: {
        connected: false,
        comingSoon: true,
      },
    };
  },
});
