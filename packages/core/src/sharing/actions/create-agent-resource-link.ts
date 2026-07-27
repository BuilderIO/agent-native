import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  buildAgentAccessApiUrl,
  buildAgentAccessUrl,
  createScopedAgentAccessGrant,
} from "../../server/agent-access.js";
import { getConfiguredAppBasePath } from "../../server/app-base-path.js";
import {
  getRequestContext,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { ForbiddenError, resolveAccess } from "../access.js";
import { requireShareableResource } from "../registry.js";

function appOrigin(): string {
  const origin =
    getRequestContext()?.requestOrigin ||
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";
  try {
    return new URL(origin).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export default defineAction({
  description:
    "Create a temporary, read-only, agent-readable link for a registered shareable resource. The token is scoped to exactly one resource and does not change the resource visibility.",
  schema: z.object({
    resourceType: z.string().describe("Shareable resource type"),
    resourceId: z.string().describe("Resource ID"),
  }),
  readOnly: true,
  run: async (args) => {
    const reg = requireShareableResource(args.resourceType);
    const agentReadable = reg.agentReadable;
    if (!agentReadable) {
      throw new ForbiddenError(
        `${reg.displayName} does not expose an agent-readable context endpoint.`,
      );
    }

    const access = await resolveAccess(args.resourceType, args.resourceId);
    if (!access) {
      throw new ForbiddenError(
        `No access to ${args.resourceType} ${args.resourceId}`,
      );
    }

    const pagePath =
      agentReadable.getPagePath?.(access.resource) ??
      reg.getResourcePath?.(access.resource);
    const contextPath = agentReadable.getContextPath(access.resource);
    if (!pagePath || !contextPath) {
      throw new ForbiddenError(`${reg.displayName} is not agent-readable yet.`);
    }

    const grant = createScopedAgentAccessGrant({
      resourceKind: agentReadable.resourceKind,
      resourceId: args.resourceId,
      viewerEmail: getRequestUserEmail() || undefined,
      ttlSeconds: agentReadable.ttlSeconds,
    });
    const origin = appOrigin();
    const basePath = getConfiguredAppBasePath();

    return {
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      url: buildAgentAccessUrl({
        path: pagePath,
        origin,
        basePath,
        token: grant.token,
      }),
      contextUrl: buildAgentAccessApiUrl({
        endpoint: contextPath,
        resourceId: args.resourceId,
        origin,
        basePath,
        token: grant.token,
      }),
      expiresAt: grant.expiresAt,
      ttlSeconds: grant.ttlSeconds,
    };
  },
});
