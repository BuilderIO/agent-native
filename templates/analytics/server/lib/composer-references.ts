import { getOrgContext } from "@agent-native/core/org";
import {
  getRequestUserEmail,
  getRequestOrgId,
  type AgentChatReference,
} from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { createError, type H3Event } from "h3";

import { composerReferenceMessages } from "./composer-reference-messages.js";
import { listLegacyDashboardSummaries } from "./legacy-dashboard-summaries.js";
export async function searchDashboardMentions(query: string, event?: H3Event) {
  if (!event)
    throw createError({
      statusCode: 401,
      statusMessage: (await composerReferenceMessages()).authentication,
    });
  const { listDashboardSummaries } = await import("../lib/dashboards-store.js");
  const ctx = await getOrgContext(event);
  const rows = await listDashboardSummaries(
    { email: ctx.email, orgId: ctx.orgId ?? null },
    {
      hidden: query ? "all" : "visible",
      search: query.slice(0, 200),
      limit: 20,
      legacyScan: "strict",
    },
  );
  return rows.map((dashboard) => ({
    id: `dashboard:${dashboard.id}`,
    label: dashboard.name || dashboard.id,
    description: `/dashboards/${dashboard.id}`,
    icon: "deck",
    refType: "dashboard",
    refId: dashboard.id,
    refPath: `/dashboards/${dashboard.id}`,
  }));
}

export async function validateDashboardReferences(
  references: readonly AgentChatReference[],
) {
  for (const reference of references) {
    if (reference.type !== "mention" || reference.refType !== "dashboard")
      continue;
    if (!reference.refId)
      throw createError({
        statusCode: 400,
        statusMessage: (await composerReferenceMessages()).invalid,
      });
    try {
      const email = getRequestUserEmail();
      const legacy = email
        ? await listLegacyDashboardSummaries(
            { email, orgId: getRequestOrgId() ?? null },
            { id: reference.refId, limit: 1 },
          )
        : [];
      if (legacy.length) continue;
      await assertAccess("dashboard", reference.refId, "viewer", undefined, {
        skipResourceBody: true,
      });
    } catch (error) {
      if (error instanceof ForbiddenError)
        throw new ForbiddenError(
          (await composerReferenceMessages()).unavailable,
        );
      throw error;
    }
  }
}
