import {
  AGENT_ACCESS_PARAM,
  verifyScopedAgentAccessToken,
} from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { PLAN_AGENT_RESOURCE_KIND } from "../../../shared/agent-readable.js";
import { loadPlanBundle, loadPlanBundleForAgentAccess } from "../../plans.js";

function queryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");

  const query = getQuery(event);
  const id = queryString(query.id);
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Plan id is required" };
  }

  const token = queryString(query[AGENT_ACCESS_PARAM]);
  try {
    const tokenAccess = token
      ? verifyScopedAgentAccessToken(token, {
          resourceKind: PLAN_AGENT_RESOURCE_KIND,
          resourceId: id,
        }).ok
      : false;
    const bundle = tokenAccess
      ? await loadPlanBundleForAgentAccess(id)
      : await loadPlanBundle(id);

    return {
      resourceType: "plan",
      id: bundle.plan.id,
      title: bundle.plan.title,
      kind: bundle.plan.kind,
      access: bundle.access,
      plan: bundle.plan,
      sections: bundle.sections,
      comments: bundle.comments,
      events: bundle.events,
      summary: bundle.summary,
      url:
        bundle.plan.kind === "recap"
          ? `/recaps/${bundle.plan.id}`
          : `/plans/${bundle.plan.id}`,
    };
  } catch (error: any) {
    setResponseStatus(event, error?.statusCode === 403 ? 403 : 404);
    return { error: "Plan not found" };
  }
});
