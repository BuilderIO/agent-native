import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { exportPlanContentToMdxFolder } from "../server/plan-mdx.js";
import { loadPlanBundle, planDeepLink, planPath } from "../server/plans.js";
import {
  planConnectCommand,
  resolvePlanHostedUrl,
  resolvePlanPublishAuth,
} from "../server/lib/plan-publish.js";

/**
 * The share/account bridge for local-first plans.
 *
 * A local plan lives in local SQL + repo MDX with no login. To SHARE it, the
 * user connects an account (lazy account creation) and the plan is published to
 * a hosted Agent-Native instance, which can then be shared via the core sharing
 * actions (share-resource / set-resource-visibility).
 *
 * Auth/token contract (see server/lib/plan-publish.ts):
 *   - Reads the hosted base URL + bearer token written by `agent-native connect`
 *     (env vars or ~/.agent-native/plan-publish.json).
 *   - When no token is available, returns `{ needsAuth: true, connectCommand,
 *     authUrl }` instead of throwing, so the client can trigger lazy account
 *     creation. The agent/UI surfaces the connect command.
 *   - When authed, uploads the plan to the hosted `import-visual-plan-source`
 *     action (same MDX payload contract) and returns `{ url, hostedPlanId }`.
 */
export default defineAction({
  description:
    "Publish a local Agent-Native Plan to the connected hosted instance so it can be shared. Local plans are private/no-login by default; call this when the user wants to share. If no account is connected yet, this returns a structured needsAuth result with the connect command instead of failing.",
  schema: z.object({
    planId: z.string().describe("Local plan ID to publish."),
    visibility: z
      .enum(["private", "org", "public"])
      .optional()
      .describe(
        "Optional initial visibility for the hosted copy. Defaults to private; set sharing afterwards with set-resource-visibility / share-resource.",
      ),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: false,
    isConsequential: true,
    title: "Publish Visual Plan",
    description:
      "Publish a local plan to the connected hosted instance for sharing, or report that an account must be connected first.",
  },
  run: async (args) => {
    // Load the local plan (scoped by the current owner / local identity).
    const bundle = await loadPlanBundle(args.planId);

    const hostedUrl = resolvePlanHostedUrl();
    const auth = resolvePlanPublishAuth();
    if (!auth) {
      // Not connected yet — let the client trigger lazy account creation.
      // Do NOT throw: this is an expected branch in the local-first flow.
      return {
        needsAuth: true as const,
        connectCommand: planConnectCommand(hostedUrl),
        authUrl: hostedUrl,
        planId: args.planId,
        message:
          "Connect an Agent-Native account to publish and share this plan. Run the connect command, then publish again.",
      };
    }

    // Build the source-control friendly MDX payload — the same contract the
    // hosted import-visual-plan-source action consumes.
    const mdx = await exportPlanContentToMdxFolder({
      content: bundle.plan.content,
      title: bundle.plan.title,
      brief: bundle.plan.brief,
      planId: bundle.plan.id,
      url: planPath(bundle.plan.id),
    });

    const endpoint = `${auth.url}/_agent-native/actions/import-visual-plan-source`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          title: bundle.plan.title,
          brief: bundle.plan.brief,
          source: "imported",
          repoPath: bundle.plan.repoPath ?? undefined,
          status: bundle.plan.status,
          mdx: {
            "plan.mdx": mdx["plan.mdx"],
            ...(mdx["canvas.mdx"] ? { "canvas.mdx": mdx["canvas.mdx"] } : {}),
            ...(mdx[".plan-state.json"]
              ? { ".plan-state.json": mdx[".plan-state.json"] }
              : {}),
          },
        }),
      });
    } catch (err) {
      throw new Error(
        `Failed to reach the hosted instance at ${auth.url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      // Token is present but rejected — treat as needing (re)connection rather
      // than a hard failure so the client can re-run the connect flow.
      return {
        needsAuth: true as const,
        connectCommand: planConnectCommand(hostedUrl),
        authUrl: hostedUrl,
        planId: args.planId,
        message:
          "The connected account token was rejected by the hosted instance. Reconnect, then publish again.",
      };
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Publishing the plan failed (${response.status} ${response.statusText}). ${detail}`.trim(),
      );
    }

    const result = (await response.json().catch(() => null)) as {
      planId?: string;
      plan?: { id?: string };
      url?: string;
      path?: string;
    } | null;

    const hostedPlanId = result?.planId ?? result?.plan?.id;
    if (!hostedPlanId) {
      throw new Error(
        "The hosted instance accepted the plan but did not return a plan ID.",
      );
    }

    const hostedPath = result?.url ?? result?.path ?? planPath(hostedPlanId);
    const url = hostedPath.startsWith("http")
      ? hostedPath
      : `${auth.url}${hostedPath.startsWith("/") ? "" : "/"}${hostedPath}`;

    return {
      url,
      hostedPlanId,
      planId: args.planId,
      hostedUrl: auth.url,
      // The hosted copy starts private; sharing is set via the core sharing
      // actions (set-resource-visibility / share-resource) on the hosted plan.
      requestedVisibility: args.visibility ?? "private",
    };
  },
  link: ({ result }) => {
    const url = (result as { url?: string } | null)?.url;
    if (!url) return null;
    return {
      url,
      label: "Open Published Plan",
      view: "plan",
    };
  },
});
