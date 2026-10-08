import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadPlanAssetsForExport } from "../server/lib/plan-assets.js";
import {
  planConnectCommand,
  resolvePlanHostedUrl,
  resolvePlanPublishAuth,
} from "../server/lib/plan-publish.js";
import { exportPlanContentToMdxFolder } from "../server/plan-mdx.js";
import {
  assertPlanEditor,
  emitPlanPublished,
  loadPlanBundle,
  planDeepLink,
  planPath,
  writeEvent,
} from "../server/plans.js";

function sameHostedOrigin(
  hostedPlanUrl: string | null | undefined,
  url: string,
) {
  if (!hostedPlanUrl) return false;
  try {
    return new URL(hostedPlanUrl).origin === new URL(url).origin;
  } catch {
    return hostedPlanUrl
      .replace(/\/+$/, "")
      .startsWith(url.replace(/\/+$/, ""));
  }
}

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
    await assertPlanEditor(args.planId);
    const bundle = await loadPlanBundle(args.planId);

    const hostedUrl = resolvePlanHostedUrl();
    const auth = resolvePlanPublishAuth();
    if (!auth) {
      return {
        needsAuth: true as const,
        connectCommand: planConnectCommand(hostedUrl),
        authUrl: hostedUrl,
        planId: args.planId,
        message:
          "Connect an Agent-Native account to publish and share this plan. Run the connect command, then publish again.",
      };
    }

    const [mdx, sqlAssets] = await Promise.all([
      exportPlanContentToMdxFolder({
        content: bundle.plan.content,
        title: bundle.plan.title,
        brief: bundle.plan.brief,
        planId: bundle.plan.id,
        url: planPath(bundle.plan.id, bundle.plan.kind),
      }),
      loadPlanAssetsForExport(bundle.plan.id),
    ]);

    const combinedAssets = { ...sqlAssets, ...(mdx["assets/"] ?? {}) };

    const existingHostedPlanId =
      bundle.plan.hostedPlanId &&
      sameHostedOrigin(bundle.plan.hostedPlanUrl, auth.url)
        ? bundle.plan.hostedPlanId
        : undefined;
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
          ...(existingHostedPlanId ? { planId: existingHostedPlanId } : {}),
          title: bundle.plan.title,
          brief: bundle.plan.brief,
          source: "imported",
          repoPath: bundle.plan.repoPath ?? undefined,
          status: bundle.plan.status,
          mdx: {
            "plan.mdx": mdx["plan.mdx"],
            ...(mdx["canvas.mdx"] ? { "canvas.mdx": mdx["canvas.mdx"] } : {}),
            ...(mdx["prototype.mdx"]
              ? { "prototype.mdx": mdx["prototype.mdx"] }
              : {}),
            ...(mdx[".plan-state.json"]
              ? { ".plan-state.json": mdx[".plan-state.json"] }
              : {}),
            ...(Object.keys(combinedAssets).length > 0
              ? { "assets/": combinedAssets }
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

    if (args.visibility) {
      const visibilityResponse = await fetch(
        `${auth.url}/_agent-native/actions/set-resource-visibility`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            resourceType: "plan",
            resourceId: hostedPlanId,
            visibility: args.visibility,
          }),
        },
      );

      if (!visibilityResponse.ok) {
        const detail = await visibilityResponse.text().catch(() => "");
        throw new Error(
          `Published the plan, but applying ${args.visibility} visibility failed (${visibilityResponse.status} ${visibilityResponse.statusText}). ${detail}`.trim(),
        );
      }
    }

    await getDb()
      .update(schema.plans)
      .set({
        hostedPlanId,
        hostedPlanUrl: url,
      })
      .where(eq(schema.plans.id, args.planId));

    await writeEvent({
      planId: args.planId,
      type: existingHostedPlanId ? "plan.published.updated" : "plan.published",
      message: existingHostedPlanId
        ? "Updated the hosted shareable plan."
        : "Published the plan to a hosted shareable link.",
      payload: {
        hostedPlanId,
        hostedPlanUrl: url,
        requestedVisibility: args.visibility ?? "private",
      },
      createdBy: "agent",
    });

    emitPlanPublished({
      planId: args.planId,
      title: bundle.plan.title,
      kind: bundle.plan.kind,
      hostedPlanId,
      url,
      requestedVisibility: args.visibility ?? "private",
      ownerEmail: bundle.access.ownerEmail,
    });

    return {
      url,
      hostedPlanId,
      hostedPlanUrl: url,
      planId: args.planId,
      hostedUrl: auth.url,
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
